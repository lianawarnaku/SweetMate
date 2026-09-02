import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppContext, type ChoreAssignment, type ChoreCategory, type ChoreChartData, type GeneratedTask, type Roommate } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { error as hapticError } from "@/lib/haptics";
import type { ChoreFrequency, ChoreTimeOfDay } from "@/constants/choreRules";
import type { Difficulty } from "@/lib/itemDifficulty";
import { generateHouseholdTasks, parseHouseholdAmenities } from "@/lib/taskGenerator";
import { PreferenceBar } from "@/components/PreferenceBar";
import { buildBalancedChart } from "@/lib/choreEngine";
import { initialIntervalDaysFor } from "@/lib/choreSchedule";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";
import {
  ESSENTIAL_CATALOG,
  ESSENTIAL_SUBSECTION_LABELS,
  type EssentialSubsection,
} from "@/constants/essentialCatalog";
import { track } from "@/lib/analytics";
import { essentialRecommendationsForHousingType } from "@/lib/essentialRecommendations";

type PlanType = "chore-chart" | "home-checklist" | null;
type HousingType = "traditional" | "suite" | "apartment" | null;

const PREFERENCE_DIMENSIONS = [
  {
    key: "morning",
    question: "Are you okay with morning tasks?",
    helper: "e.g. unloading the dishwasher",
  },
  {
    key: "night",
    question: "Are you okay with night tasks?",
    helper: "e.g. running the dishwasher",
  },
] as const;

// ── Slot metadata (icon + color) for known slot keys; falls back for unknown ──
const SLOT_VISUAL_DEFAULT = { icon: "check-square" as keyof typeof Feather.glyphMap, color: "#8A7462" };

const SLOT_VISUAL_BY_KEY: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  bathroom_heavy: { icon: "droplet", color: "#72503A" },
  bathroom_light: { icon: "wind", color: "#A88C76" },
  bathroom: { icon: "droplet", color: "#87644B" },
  kitchen_heavy: { icon: "zap", color: "#9B623B" },
  kitchen_light: { icon: "coffee", color: "#C39870" },
  kitchen: { icon: "coffee", color: "#A7744D" },
  vacuum_mop: { icon: "layers", color: "#806B58" },
  vacuum: { icon: "layers", color: "#917661" },
  mop: { icon: "layers", color: "#A1866F" },
  laundry: { icon: "refresh-cw", color: "#B09177" },
  trash: { icon: "trash-2", color: "#65483A" },
  dishes: { icon: "circle", color: "#B98255" },
  outdoor: { icon: "sun", color: "#C19362" },
  ad_hoc: { icon: "help-circle", color: "#7B6252" },
};

function slotVisualFor(key: string) {
  return SLOT_VISUAL_BY_KEY[key] ?? SLOT_VISUAL_DEFAULT;
}

// Derive the slot list from stored chart data, falling back to week-one keys.
function getActiveSlots(data: ChoreChartData): { key: string; label: string; category?: ChoreCategory }[] {
  if (data.slots && data.slots.length > 0) return data.slots;
  const seen = new Set<string>();
  const ordered: { key: string; label: string }[] = [];
  for (const w of data.weeks) {
    for (const k of Object.keys(w.assignments)) {
      if (!seen.has(k)) {
        seen.add(k);
        ordered.push({ key: k, label: humanizeKey(k) });
      }
    }
  }
  return ordered;
}

function humanizeKey(k: string): string {
  return k
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// ── Kitchen amenities (all housing types) ──────────────────────────────────
const KITCHEN_AMENITIES = [
  { key: "kettle", label: "Kettle" },
  { key: "microwave", label: "Microwave" },
  { key: "fridge", label: "Refrigerator" },
  { key: "coffee", label: "Coffee Machine" },
  { key: "ice_maker", label: "Ice Maker" },
  { key: "toaster_oven", label: "Toaster Oven" },
  { key: "dining_table", label: "Dining Table" },
  { key: "stove", label: "Stove / Cooktop" },
  { key: "air_fryer", label: "Air Fryer" },
  { key: "toaster", label: "Toaster" },
  { key: "dishwasher", label: "Dishwasher" },
  { key: "drying_rack", label: "Drying Rack" },
  { key: "oven", label: "Oven" },
];

// ── Bathroom fixtures (suite + apartment) ──────────────────────────────────
const BATHROOM_ITEMS = [
  { key: "trash_can", label: "Trash Can" },
  { key: "sink", label: "Sink" },
  { key: "mirror", label: "Mirror" },
  { key: "cabinet", label: "Cabinet / Shelf" },
  { key: "shower", label: "Shower Area" },
  { key: "toilet", label: "Toilet" },
  { key: "bath_mat", label: "Bath Mat" },
];

// ── Bathroom chores (suite + apartment) ────────────────────────────────────
const BATHROOM_CHORES = [
  { key: "clean_floor", label: "Clean bathroom floor", points: 15 },
  { key: "restock", label: "Restock supplies (soap, TP, napkins)", points: 10 },
  { key: "clean_mirror", label: "Clean mirror & fixtures", points: 10 },
];

// ── Living area fixtures (apartment only) ──────────────────────────────────
const LIVING_ITEMS = [
  { key: "couches", label: "Couches / Sofa" },
];

// ── Living area chores (apartment only) ────────────────────────────────────
const LIVING_CHORES = [
  { key: "vacuum", label: "Vacuum floors & rugs", points: 20 },
  { key: "counters", label: "Wipe countertops & surfaces", points: 15 },
  { key: "wash_linens", label: "Wash kitchen towels & blankets", points: 15 },
  { key: "trash", label: "Take out trash & recycling", points: 10 },
  { key: "mop", label: "Mop hard floors", points: 20 },
  { key: "dishes", label: "Do the dishes", points: 15 },
  { key: "wipe_appliances", label: "Wipe down appliances", points: 10 },
];

// ── Kitchen chore map ──────────────────────────────────────────────────────
const KITCHEN_CHORE_MAP: Record<string, { title: string; points: number }> = {
  kettle: { title: "Descale kettle", points: 10 },
  microwave: { title: "Clean microwave (inside & out)", points: 10 },
  fridge: { title: "Wipe fridge shelves & door", points: 20 },
  coffee: { title: "Descale & clean coffee machine", points: 15 },
  ice_maker: { title: "Clean ice maker", points: 15 },
  toaster_oven: { title: "Clean toaster oven tray", points: 10 },
  dining_table: { title: "Wipe & disinfect dining table", points: 10 },
  stove: { title: "Clean stovetop & burners", points: 20 },
  air_fryer: { title: "Clean air fryer basket", points: 10 },
  toaster: { title: "Empty & wipe toaster", points: 5 },
  dishwasher: { title: "Run/empty dishwasher & wipe door", points: 10 },
  drying_rack: { title: "Put away dishes from drying rack", points: 10 },
  oven: { title: "Deep clean oven", points: 30 },
};

// ── Living item chore map ──────────────────────────────────────────────────
const LIVING_ITEM_CHORE_MAP: Record<string, { title: string; points: number }> = {
  couches: { title: "Vacuum & lint-roll couches", points: 15 },
};

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

// ── Reusable checkbox row ──────────────────────────────────────────────────
function CheckRow({
  label,
  checked,
  onToggle,
  accentColor,
  textColor,
  mutedColor,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View
        style={[
          styles.checkBox,
          {
            borderColor: checked ? accentColor : mutedColor + "66",
            backgroundColor: checked ? accentColor + "20" : "transparent",
          },
        ]}
      >
        {checked ? <Feather name="check" size={11} color={accentColor} /> : null}
      </View>
      <Text style={[styles.checkLabel, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Reusable chip toggle ───────────────────────────────────────────────────
function ChipToggle({
  label,
  selected,
  onToggle,
  accentColor,
  borderColor,
  textColor,
  mutedColor,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  accentColor: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: selected ? accentColor + "18" : "transparent",
          borderColor: selected ? accentColor : borderColor,
        },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      {selected ? (
        <Feather name="check-circle" size={12} color={accentColor} />
      ) : (
        <Feather name="circle" size={12} color={mutedColor} />
      )}
      <Text
        style={[
          styles.chipText,
          { color: selected ? accentColor : mutedColor },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Custom chore inline adder ──────────────────────────────────────────────
function CustomChoreInput({
  chores,
  onAdd,
  onRemove,
  accentColor,
  textColor,
  mutedColor,
  borderColor,
  cardBg,
  triggerLabel,
}: {
  chores: string[];
  onAdd: (chore: string) => void;
  onRemove: (index: number) => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  cardBg: string;
  triggerLabel?: string;
}) {
  const [inputVisible, setInputVisible] = useState(false);
  const [text, setText] = useState("");

  const confirm = () => {
    const trimmed = text.trim();
    if (trimmed) {
      onAdd(trimmed);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setText("");
    setInputVisible(false);
  };

  return (
    <View style={customStyles.wrapper}>
      {/* Existing custom chores */}
      {chores.map((chore, i) => (
        <View
          key={i}
          style={[
            customStyles.customRow,
            { backgroundColor: accentColor + "10", borderColor: accentColor + "30" },
          ]}
        >
          <Feather name="edit-3" size={12} color={accentColor} />
          <Text style={[customStyles.customText, { color: textColor }]} numberOfLines={1}>
            {chore}
          </Text>
          <TouchableOpacity
            onPress={() => onRemove(i)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="x" size={14} color={mutedColor} />
          </TouchableOpacity>
        </View>
      ))}

      {/* Input row or trigger button */}
      {inputVisible ? (
        <View
          style={[
            customStyles.inputRow,
            { backgroundColor: cardBg, borderColor: accentColor + "55" },
          ]}
        >
          <TextInput
            style={[customStyles.inlineInput, { color: textColor }]}
            placeholder="Type a chore name..."
            placeholderTextColor={mutedColor}
            value={text}
            onChangeText={setText}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={confirm}
          />
          <TouchableOpacity onPress={confirm} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Feather name="check" size={18} color={accentColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setInputVisible(false); setText(""); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="x" size={16} color={mutedColor} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[customStyles.trigger, { borderColor: accentColor + "50" }]}
          onPress={() => setInputVisible(true)}
          activeOpacity={0.7}
        >
          <View style={[customStyles.triggerIcon, { backgroundColor: accentColor + "18" }]}>
            <Feather name="plus" size={13} color={accentColor} />
          </View>
          <Text style={[customStyles.triggerText, { color: accentColor }]}>
            {triggerLabel ?? "Add a custom chore"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const customStyles = StyleSheet.create({
  wrapper: { marginTop: 14, gap: 6 },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  customText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlineInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    paddingVertical: 4,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingLeft: 10,
  },
  triggerIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});

// ── Essential item row with optional roommate assignment ───────────────────
function EssentialItemRow({
  item,
  optional,
  checked,
  shortlisted,
  onToggle,
  assignedUserIds,
  currentUserId,
  assignmentPending,
  assignmentError,
  onToggleSelfAssignment,
  accentColor,
  textColor,
  mutedColor,
  roommates,
}: {
  item: string;
  optional: boolean;
  checked: boolean;
  shortlisted: boolean;
  onToggle: () => void;
  assignedUserIds: string[];
  currentUserId: string;
  assignmentPending: boolean;
  assignmentError: boolean;
  onToggleSelfAssignment: (assigned: boolean) => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  roommates: Roommate[];
}) {
  const [showAllAssignees, setShowAllAssignees] = useState(false);
  const assignedMembers = assignedUserIds.flatMap((id) => {
    const member = roommates.find((roommate) => roommate.id === id);
    return member ? [member] : [];
  });
  const currentUserAssigned = assignedUserIds.includes(currentUserId);
  const previewNames = assignedMembers
    .slice(0, showAllAssignees ? assignedMembers.length : 3)
    .map((member) => (member.id === currentUserId ? "You" : member.name));
  const overflowCount = Math.max(0, assignedMembers.length - previewNames.length);
  const assignmentSummary = [
    ...previewNames,
    ...(overflowCount ? [`+${overflowCount}`] : []),
  ].join(", ");
  return (
    <View>
      <TouchableOpacity
        style={styles.checkRow}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${checked ? "Remove" : "Mark"} ${item} ${checked ? "from owned items" : "as owned"}`}
      >
        <View
          style={[
            styles.checkBox,
            {
              borderColor: checked ? accentColor : mutedColor + "66",
              backgroundColor: checked ? accentColor + "20" : "transparent",
            },
          ]}
        >
          {checked ? <Feather name="check" size={11} color={accentColor} /> : null}
        </View>
        <Text style={[styles.checkLabel, { color: textColor, flex: 1 }]}>
          {item}{optional ? <Text style={{ color: mutedColor }}> · Optional</Text> : null}
        </Text>
      </TouchableOpacity>
      {shortlisted && (assignedMembers.length > 0 || !checked) && (
        <View style={essentialRowStyles.assignRow}>
          <Pressable
            disabled={assignedMembers.length <= 3}
            onPress={() => setShowAllAssignees((current) => !current)}
            accessibilityRole={assignedMembers.length > 3 ? "button" : undefined}
            accessibilityHint={
              assignedMembers.length > 3
                ? showAllAssignees
                  ? "Collapses the full assignee list"
                  : "Shows every assigned Sweetmate"
                : undefined
            }
            style={essentialRowStyles.assignmentCopy}
          >
            <Text
              style={[essentialRowStyles.assignLabel, { color: mutedColor }]}
              numberOfLines={2}
              accessibilityLabel={
                assignedMembers.length
                  ? `Assigned to ${assignedMembers.map((member) =>
                      member.id === currentUserId ? "you" : member.name,
                    ).join(", ")}`
                  : "No Sweetmates assigned"
              }
            >
              {assignmentSummary || "No one assigned yet"}
            </Text>
            {assignmentError ? (
              <Text style={[essentialRowStyles.assignmentError, { color: "#B42318" }]}>
                Couldn’t save. Try again.
              </Text>
            ) : null}
          </Pressable>
          <TouchableOpacity
            disabled={assignmentPending}
            onPress={() => onToggleSelfAssignment(!currentUserAssigned)}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: currentUserAssigned,
              disabled: assignmentPending,
            }}
            accessibilityLabel={
              currentUserAssigned
                ? `Remove your assignment from ${item}`
                : `Assign yourself to ${item}`
            }
            style={[
              essentialRowStyles.selfAssignButton,
              {
                borderColor: currentUserAssigned ? accentColor : mutedColor + "66",
                backgroundColor: currentUserAssigned
                  ? accentColor + "18"
                  : "transparent",
                opacity: assignmentPending ? 0.55 : 1,
              },
            ]}
          >
            <Feather
              name={currentUserAssigned ? "check" : "user-plus"}
              size={13}
              color={currentUserAssigned ? accentColor : mutedColor}
            />
            <Text
              style={[
                essentialRowStyles.selfAssignText,
                { color: currentUserAssigned ? accentColor : textColor },
              ]}
            >
              {currentUserAssigned ? "I’m getting this" : "I’ll get this"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const essentialRowStyles = StyleSheet.create({
  assignRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 30,
    paddingRight: 4,
    paddingBottom: 8,
    gap: 10,
    flexWrap: "wrap",
  },
  assignmentCopy: { flex: 1, minWidth: 110 },
  assignLabel: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  assignmentError: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 2 },
  selfAssignButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1,
  },
  selfAssignText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
});

// ── Section card wrapper ───────────────────────────────────────────────────
function SectionCard({
  title,
  icon,
  children,
  cardBg,
  cardBorder,
  titleColor,
  iconBg,
  accentColor,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  cardBg: string;
  cardBorder: string;
  titleColor: string;
  iconBg: string;
  accentColor: string;
}) {
  return (
    <View
      style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
    >
      <View style={styles.sectionCardHeader}>
        <View style={[styles.sectionCardIcon, { backgroundColor: iconBg }]}>
          <Feather name={icon as any} size={16} color={accentColor} />
        </View>
        <Text style={[styles.sectionCardTitle, { color: titleColor }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function PlanningScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    type?: string;
    setup?: string;
    housingType?: string;
  }>();
  const setupMode = params.setup === "household";
  const {
    roommates, addChore, addChores, essentialsAssignees, setEssentialSelfAssignment,
    essentialOwned, essentialShortlist, essentialShortlistUpdatedBy,
    setEssentialOwned, saveEssentialShortlist, addSelectedEssentialsToShopping,
    pointsEnabled, householdComplete, householdId, homeProfile, customTasks,
    addCustomTask, deleteCustomTask, memberPreferences, setMemberPreference,
    currentUserId, setHouseholdSetupStep,
  } = useAppContext();
  const recommendations = essentialRecommendationsForHousingType(
    setupMode ? params.housingType : homeProfile?.housingType,
  );
  const recommendedKeys = new Set(
    recommendations.map(({ categoryId, itemId }) => `${categoryId}:${itemId}`),
  );

  const [selectedType, setSelectedType] = useState<PlanType>(() =>
    params.type === "home-checklist" || params.type === "chore-chart"
      ? params.type
      : null,
  );
  const [housingType, setHousingType] = useState<HousingType>(homeProfile?.housingType ?? null);
  const [kitchenAmenities, setKitchenAmenities] = useState<Set<string>>(new Set());
  const [bathroomItems, setBathroomItems] = useState<Set<string>>(new Set());
  const [bathroomChores, setBathroomChores] = useState<Set<string>>(new Set());
  const [livingItems, setLivingItems] = useState<Set<string>>(new Set());
  const [livingChores, setLivingChores] = useState<Set<string>>(new Set());
  const [customKitchenChores, setCustomKitchenChores] = useState<string[]>([]);
  const [customBathroomChores, setCustomBathroomChores] = useState<string[]>([]);
  const [customLivingChores, setCustomLivingChores] = useState<string[]>([]);
  const [checkedEssentials, setCheckedEssentials] = useState<Record<string, Set<string>>>({});
  const [customEssentials, setCustomEssentials] = useState<Record<string, string[]>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [shortlistDraft, setShortlistDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [result, setResult] = useState<string | null>(null);
  const [choreChartData, setChoreChartData] = useState<ChoreChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choresAdded, setChoresAdded] = useState(0);
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([]);
  const [customTaskTitle, setCustomTaskTitle] = useState("");
  const [customTaskDifficulty, setCustomTaskDifficulty] = useState<Difficulty>(3);
  const [customTaskFrequency, setCustomTaskFrequency] = useState<ChoreFrequency>("weekly");
  const [customTaskTime, setCustomTaskTime] = useState<ChoreTimeOfDay>("any");
  const [pendingAssignments, setPendingAssignments] = useState<Set<string>>(
    new Set(),
  );
  const [assignmentErrors, setAssignmentErrors] = useState<Set<string>>(
    new Set(),
  );
  const [shortlistSaving, setShortlistSaving] = useState(false);
  const [shortlistSaveMessage, setShortlistSaveMessage] = useState<string | null>(
    null,
  );
  const [shortlistTransferMessage, setShortlistTransferMessage] = useState<string | null>(null);
  const [shortlistTransferLoading, setShortlistTransferLoading] = useState(false);
  const shortlistSavePendingRef = useRef(false);
  const shortlistTransferPendingRef = useRef(false);
  const shortlistBaselineRef = useRef(essentialShortlist);
  const pendingAssignmentKeysRef = useRef(new Set<string>());
  const openedSetupShortlistRef = useRef(false);
  const continuingSetupRef = useRef(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;
  const shortlistSelectedCount = Object.values(shortlistDraft).reduce(
    (total, section) => total + Object.values(section).filter(Boolean).length,
    0,
  );

  function toggleSet(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function toggleEssential(sectionKey: string, item: string) {
    setCheckedEssentials((prev) => {
      const cur = new Set(prev[sectionKey] ?? []);
      if (cur.has(item)) cur.delete(item);
      else cur.add(item);
      return { ...prev, [sectionKey]: cur };
    });
  }

  async function toggleSelfAssignment(
    sectionId: string,
    itemId: string,
    assigned: boolean,
  ) {
    const key = `${sectionId}:${itemId}`;
    if (pendingAssignmentKeysRef.current.has(key)) return;
    pendingAssignmentKeysRef.current.add(key);
    setPendingAssignments((current) => new Set(current).add(key));
    setAssignmentErrors((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    const saved = await setEssentialSelfAssignment(sectionId, itemId, assigned);
    if (!saved) {
      setAssignmentErrors((current) => new Set(current).add(key));
    }
    setPendingAssignments((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    pendingAssignmentKeysRef.current.delete(key);
  }

  function addCustomEssential(sectionKey: string, item: string) {
    setCustomEssentials((prev) => ({
      ...prev,
      [sectionKey]: [...(prev[sectionKey] ?? []), item],
    }));
  }

  function removeCustomEssential(sectionKey: string, idx: number) {
    setCustomEssentials((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] ?? []).filter((_, i) => i !== idx),
    }));
  }

  function toggleExpandSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openShortlist() {
    const next = Object.fromEntries(
      ESSENTIAL_CATALOG.map((category) => [
        category.id,
        Object.fromEntries(
          category.items.map((entry) => [
            entry.id,
            Boolean(essentialShortlist[category.id]?.[entry.id]),
          ]),
        ),
      ]),
    );
    setShortlistDraft(next);
    shortlistBaselineRef.current = essentialShortlist;
    setShortlistSaveMessage(null);
    setShortlistTransferMessage(null);
    setShortlistOpen(true);
    track.shortlistOpened({ source: "sweet_essentials" });
  }

  useEffect(() => {
    if (!setupMode || openedSetupShortlistRef.current) return;
    openedSetupShortlistRef.current = true;
    openShortlist();
  }, [setupMode]);

  function setDraftItem(categoryId: string, itemId: string, selected: boolean) {
    setShortlistSaveMessage(null);
    setShortlistTransferMessage(null);
    setShortlistDraft((current) => ({
      ...current,
      [categoryId]: { ...(current[categoryId] ?? {}), [itemId]: selected },
    }));
  }

  function selectRecommendedItems() {
    setShortlistSaveMessage(null);
    setShortlistTransferMessage(null);
    setShortlistDraft((current) =>
      recommendations.reduce(
        (next, { categoryId, itemId }) => ({
          ...next,
          [categoryId]: {
            ...(next[categoryId] ?? {}),
            [itemId]: true,
          },
        }),
        current,
      ),
    );
  }

  function toggleOwnedItem(categoryId: string, itemId: string) {
    const willOwn = !essentialOwned[categoryId]?.[itemId];
    setEssentialOwned(categoryId, itemId, willOwn);
  }

  function setDraftSubsection(
    categoryId: string,
    subsection: EssentialSubsection,
    selected: boolean,
  ) {
    const category = ESSENTIAL_CATALOG.find((entry) => entry.id === categoryId);
    if (!category) return;
    setShortlistTransferMessage(null);
    setShortlistDraft((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] ?? {}),
        ...Object.fromEntries(
          category.items
            .filter((entry) => entry.subsection === subsection)
            .map((entry) => [entry.id, selected]),
        ),
      },
    }));
  }

  async function saveShortlist() {
    if (shortlistSavePendingRef.current) return false;
    shortlistSavePendingRef.current = true;
    setShortlistSaving(true);
    setShortlistSaveMessage(null);
    const saved = await saveEssentialShortlist(
      shortlistDraft,
      shortlistBaselineRef.current,
    );
    shortlistSavePendingRef.current = false;
    setShortlistSaving(false);
    if (!saved) {
      setShortlistSaveMessage("Couldn’t save your shortlist. Your selections are still here.");
      return false;
    }
    const count = Object.values(shortlistDraft).reduce(
      (total, section) => total + Object.values(section).filter(Boolean).length,
      0,
    );
    track.shortlistSaved({
      item_count_bucket: count <= 5 ? "1_5" : count <= 10 ? "6_10" : "11_plus",
      category_count: Object.values(shortlistDraft).filter((section) =>
        Object.values(section).some(Boolean),
      ).length,
      source: "sweet_essentials",
    });
    setShortlistSaveMessage(
      count
        ? "Shortlist saved for your household."
        : "Shortlist cleared.",
    );
    shortlistBaselineRef.current = shortlistDraft;
    return true;
  }

  function addSelectedToShopping() {
    if (shortlistTransferPendingRef.current) return;
    shortlistTransferPendingRef.current = true;
    setShortlistTransferLoading(true);
    setShortlistTransferMessage(null);
    try {
      const transfer = addSelectedEssentialsToShopping(shortlistDraft);
      const parts = [`${transfer.itemsAdded} added`];
      if (transfer.itemsAlreadyActive) {
        parts.push(`${transfer.itemsAlreadyActive} already in Shopping`);
      }
      setShortlistTransferMessage(
        `${parts.join(" · ")} across ${transfer.affectedListIds.length} ${
          transfer.affectedListIds.length === 1 ? "Shopping list" : "Shopping lists"
        }.`,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (transferError) {
      reportRuntimeError("Add selected Sweet Essentials to Shopping", transferError);
      hapticError();
      setShortlistTransferMessage("Couldn’t add these items to Shopping. Please try again.");
    } finally {
      shortlistTransferPendingRef.current = false;
      setShortlistTransferLoading(false);
    }
  }

  async function continueHouseholdSetup() {
    if (continuingSetupRef.current) return;
    continuingSetupRef.current = true;
    try {
      const saved = await saveShortlist();
      if (!saved) {
        continuingSetupRef.current = false;
        return;
      }
      await setHouseholdSetupStep("items");
      router.replace("/sweet-setup" as never);
    } catch (setupError) {
      continuingSetupRef.current = false;
      reportRuntimeError("continue household setup", setupError);
      setError("We couldn't continue setup. Your selected items are still saved.");
    }
  }

  // ── Build + create chores ────────────────────────────────────────────────
  // Each chore *group* (Bathroom Heavy etc.) is expanded into the individual
  // tasks it covers, so the user sees them as separate to-dos in My Home and
  // the Group tab.
  function createChores(): number {
    if (!housingType) return 0;
    const n = roommates.length;
    let count = 0;

    type Subtask = { title: string; category: ChoreCategory; points: number };

    // Legacy slot expansion retained only for previously stored charts.
    const subtasksFor = (slotKey: string, slotLabel?: string, slotCategory?: ChoreCategory): Subtask[] => {
      switch (slotKey) {
        case "bathroom_heavy":
          return [
            { title: "Clean toilet", category: "bathroom", points: 15 },
            { title: "Clean shower / tub", category: "bathroom", points: 15 },
            { title: "Sweep & mop bathroom floor", category: "bathroom", points: 15 },
          ];
        case "bathroom_light":
        case "bathroom": {
          const list: Subtask[] = [
            { title: "Clean bathroom sink", category: "bathroom", points: 10 },
            { title: "Clean bathroom mirror", category: "bathroom", points: 10 },
            { title: "Restock bathroom supplies", category: "bathroom", points: 10 },
            { title: "Empty bathroom trash", category: "bathroom", points: 10 },
          ];
          if (bathroomItems.has("bath_mat")) {
            list.push({ title: "Wash bathmat", category: "bathroom", points: 10 });
          }
          return list;
        }
        case "kitchen_heavy": {
          const heavyKeys = ["stove", "microwave", "oven", "air_fryer", "toaster_oven"];
          const labels = heavyKeys
            .filter((k) => kitchenAmenities.has(k))
            .map((k) => KITCHEN_AMENITIES.find((a) => a.key === k)?.label)
            .filter((l): l is string => !!l);
          const tasks: Subtask[] =
            labels.length > 0
              ? labels.map((label) => ({
                  title: `Clean ${label.toLowerCase()}`,
                  category: "kitchen",
                  points: 15,
                }))
              : [
                  { title: "Clean stove", category: "kitchen", points: 15 },
                  { title: "Clean microwave", category: "kitchen", points: 15 },
                ];
          tasks.push({ title: "Wipe down kitchen appliances", category: "kitchen", points: 10 });
          return tasks;
        }
        case "kitchen_light":
        case "kitchen": {
          const tasks: Subtask[] = [
            { title: "Wipe kitchen countertops", category: "kitchen", points: 10 },
          ];
          if (kitchenAmenities.has("dishwasher"))
            tasks.push({ title: "Run / unload dishwasher", category: "kitchen", points: 10 });
          if (kitchenAmenities.has("drying_rack"))
            tasks.push({ title: "Empty drying rack", category: "kitchen", points: 10 });
          if (kitchenAmenities.has("fridge"))
            tasks.push({ title: "Check & tidy fridge", category: "kitchen", points: 10 });
          if (kitchenAmenities.has("dining_table"))
            tasks.push({ title: "Wipe dining table", category: "kitchen", points: 10 });
          if (tasks.length === 1) {
            tasks.push({ title: "Run / unload dishwasher", category: "kitchen", points: 10 });
            tasks.push({ title: "Check & tidy fridge", category: "kitchen", points: 10 });
          }
          return tasks;
        }
        case "vacuum_mop":
        case "vacuum":
        case "mop":
          return [
            { title: "Vacuum common areas", category: "cleaning", points: 15 },
            { title: "Vacuum hallway", category: "cleaning", points: 10 },
            { title: "Mop living room", category: "cleaning", points: 10 },
          ];
        case "laundry":
          return [
            { title: "Wash & dry laundry", category: "laundry", points: 15 },
            { title: "Fold & put away laundry", category: "laundry", points: 10 },
          ];
        case "trash":
          return [
            { title: "Take out trash & recycling", category: "other", points: 10 },
          ];
        case "dishes":
          return [{ title: "Do the dishes", category: "kitchen", points: 10 }];
        case "outdoor":
          return [{ title: "Outdoor cleanup / yard tasks", category: "outdoor", points: 15 }];
        case "ad_hoc":
          return [
            { title: "Ad hoc helper — assist where needed", category: "other", points: 10 },
          ];
        default: {
          // Unknown slot key — make one chore using the slot's label
          const title = slotLabel ?? slotKey.replace(/_/g, " ");
          return [{ title, category: slotCategory ?? "other", points: 10 }];
        }
      }
    };

    // ── Resolve a previously stored chart or use the legacy fixed defaults ──
    const fallbackSlots: { key: string; label: string; category?: ChoreCategory }[] = [
      { key: "bathroom_heavy", label: "Bathroom Heavy", category: "bathroom" },
      { key: "kitchen_heavy", label: "Kitchen Heavy", category: "kitchen" },
      { key: "bathroom_light", label: "Bathroom Light", category: "bathroom" },
      { key: "kitchen_light", label: "Kitchen Light", category: "kitchen" },
      { key: "vacuum_mop", label: "Vacuum & Mop", category: "cleaning" },
      { key: "ad_hoc", label: "Ad Hoc", category: "other" },
    ];

    let activeSlots: { key: string; label: string; category?: ChoreCategory }[];
    let week1: Record<string, string>;
    if (choreChartData?.weeks?.[0]?.assignments) {
      week1 = { ...choreChartData.weeks[0].assignments };
      activeSlots =
        choreChartData.slots && choreChartData.slots.length > 0
          ? choreChartData.slots
          : Object.keys(week1).map((k) => ({ key: k, label: k }));
    } else {
      // No stored chart — assign roommates 1:1 to the fixed legacy slots
      week1 = {};
      activeSlots = fallbackSlots.slice(0, Math.min(n, fallbackSlots.length));
      for (let i = 0; i < activeSlots.length; i++) {
        week1[activeSlots[i].key] = roommates[i].name;
      }
    }

    // Expand each slot into its individual subtasks for the assigned person
    for (const slot of activeSlots) {
      const name = week1[slot.key];
      if (!name) continue;
      const roommate = roommates.find((r) => r.name === name);
      if (!roommate) continue;
      for (const t of subtasksFor(slot.key, slot.label, slot.category)) {
        addChore({
          title: t.title,
          assignedTo: roommate.id,
          dueDate: daysFromNow(7),
          completed: false,
          points: t.points,
          category: t.category,
        });
        count++;
      }
    }

    // ── Custom chores (user-defined additions) — rotate through roommates ──
    const allCustom: [string, ChoreCategory, number][] = [
      ...customKitchenChores.map((t): [string, ChoreCategory, number] => [t, "kitchen", 15]),
      ...customBathroomChores.map((t): [string, ChoreCategory, number] => [t, "bathroom", 15]),
      ...customLivingChores.map((t): [string, ChoreCategory, number] => [t, "cleaning", 15]),
    ];
    allCustom.forEach(([title, cat, pts], idx) => {
      count++;
      addChore({ title, assignedTo: roommates[idx % n].id, dueDate: daysFromNow(7), completed: false, points: pts, category: cat });
    });

    return count;
  }

  // ── Build a local checklist summary ─────────────────────────────────────
  function buildContext(): string {
    const parts: string[] = [];
    if (housingType) {
      const typeLabel =
        housingType === "traditional"
          ? "traditional-style (shared room, communal bathroom)"
          : housingType === "suite"
          ? "suite-style (private bedroom, en-suite bathroom)"
          : "apartment-style (full kitchen, private bathroom, living area)";
      parts.push(`Housing: ${typeLabel}`);
    }
    if (kitchenAmenities.size > 0) {
      parts.push(`Kitchen amenities: ${[...kitchenAmenities].map((k) => KITCHEN_AMENITIES.find((a) => a.key === k)?.label).filter(Boolean).join(", ")}`);
    }
    if (housingType !== "traditional") {
      if (bathroomItems.size > 0)
        parts.push(`Bathroom fixtures: ${[...bathroomItems].map((k) => BATHROOM_ITEMS.find((a) => a.key === k)?.label).filter(Boolean).join(", ")}`);
      if (bathroomChores.size > 0)
        parts.push(`Bathroom tasks: ${[...bathroomChores].map((k) => BATHROOM_CHORES.find((a) => a.key === k)?.label).filter(Boolean).join(", ")}`);
    }
    if (housingType === "apartment") {
      if (livingItems.size > 0)
        parts.push(`Living area items: ${[...livingItems].map((k) => LIVING_ITEMS.find((a) => a.key === k)?.label).filter(Boolean).join(", ")}`);
      if (livingChores.size > 0)
        parts.push(`Living area tasks: ${[...livingChores].map((k) => LIVING_CHORES.find((a) => a.key === k)?.label).filter(Boolean).join(", ")}`);
    }
    // ── Home essentials selections ──
    if (selectedType === "home-checklist") {
      ESSENTIAL_CATALOG.forEach((section) => {
        const checked = checkedEssentials[section.id];
        const custom = customEssentials[section.id] ?? [];
        const items = [...(checked ? [...checked] : []), ...custom];
        if (items.length > 0) {
          const assignments = essentialsAssignees[section.id] ?? {};
          const itemsWithAssignment = items.map((item) => {
            const names = (assignments[item] ?? []).flatMap((userId) => {
              const member = roommates.find((roommate) => roommate.id === userId);
              return member ? [member.name] : [];
            });
            return names.length ? `${item} (${names.join(", ")})` : item;
          });
          parts.push(`${section.title} (selected): ${itemsWithAssignment.join(", ")}`);
        }
      });
    }

    return parts.join(". ");
  }

  const generate = async () => {
    if (!selectedType) return;
    if (selectedType === "chore-chart" && !householdComplete) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setChoreChartData(null);
    setChoresAdded(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (selectedType === "chore-chart") {
        if (!householdId || !homeProfile) {
          throw new Error("Complete household setup before generating tasks.");
        }
        const tasks = await generateHouseholdTasks(
          householdId,
          parseHouseholdAmenities(homeProfile.items).flatMap((amenity) => {
            const count = amenity.category === "bathroom"
              ? Math.max(1, homeProfile.roomCounts?.bathroom ?? 1)
              : 1;
            return Array.from({ length: count }, (_, index) => ({
              ...amenity,
              roomInstanceId: `${amenity.category}-${index + 1}`,
            }));
          }),
          homeProfile.housingType,
          customTasks,
        );
        setGeneratedTasks(tasks);
        const chart = buildBalancedChart(tasks, roommates, [], { mode: "perfectSplit" });
        const assigneeByTask = new Map<string, string>();
        chart.assignments.forEach((assignment) =>
          assignment.taskIds.forEach((taskId) => assigneeByTask.set(taskId, assignment.memberId)),
        );
        const pointByDifficulty = [0, 5, 10, 15, 25, 30] as const;
        const now = Date.now();
        const added = addChores(tasks.map((task) => {
          const intervalDays = initialIntervalDaysFor(task.frequency);
          return {
            title: task.title,
            assignedTo: assigneeByTask.get(task.id) ?? roommates[0].id,
            dueDate: new Date(now + intervalDays * 86_400_000).toISOString(),
            completed: false,
            points: pointByDifficulty[task.difficulty],
            category:
              task.itemCategory === "bathroom" ? "bathroom" :
              task.itemCategory === "kitchen" ? "kitchen" :
              task.itemCategory === "living" ? "cleaning" : "other",
            // task.frequency and Chore's recurring field share the same
            // daily/everyOtherDay/weekly/biweekly/monthly union — pass it
            // through directly instead of re-deriving it, which previously
            // collapsed everyOtherDay into daily and biweekly into weekly.
            recurring: task.frequency,
            sourceKey: task.id,
          };
        }));
        setChoresAdded(added);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      openShortlist();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      reportRuntimeError("build formulaic household plan", error, { selectedType });
      const message = error instanceof Error ? error.message : "Unable to build the plan. Please try again.";
      setError(message);
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const addTasks = () => {
    if (!housingType) return;
    const added = createChores();
    setChoresAdded(added);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const isChoreChart = selectedType === "chore-chart";
  const canGenerate =
    selectedType !== null &&
    (selectedType === "home-checklist" || (isChoreChart && householdComplete && housingType !== null));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() =>
              setupMode
                ? router.replace("/sweet-setup" as never)
                : router.back()
            }
            style={[styles.backBtn, { backgroundColor: colors.muted }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="chevron-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {setupMode ? "Sweet Essentials" : "Planning Helper"}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {setupMode ? "Choose what your new Sweet needs" : "Choose a tool, customize it, then review"}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Plan type selector ── */}
      {!setupMode ? <><Text style={[styles.sectionLabel, { color: colors.foreground }]}>
        Choose a planning tool
      </Text>

      <View accessibilityRole="radiogroup" style={styles.typeRow}>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ checked: isChoreChart, disabled: !householdComplete }}
          accessibilityLabel="Chore Chart"
          accessibilityHint={householdComplete ? "Build a weekly chore rotation" : "Finish household setup to unlock"}
          disabled={!householdComplete}
          style={[
            styles.typeCard,
            {
              backgroundColor: isChoreChart ? colors.primary + "12" : colors.card,
              borderColor: isChoreChart ? colors.primary : colors.border,
              opacity: householdComplete ? 1 : 0.58,
            },
          ]}
          onPress={() => {
            setSelectedType("chore-chart");
            setResult(null);
            setChoresAdded(0);
          }}
        >
          <View
            style={[
              styles.typeIcon,
              { backgroundColor: isChoreChart ? colors.primary + "20" : colors.secondary },
            ]}
          >
            <Feather
              name="calendar"
              size={24}
              color={isChoreChart ? colors.primary : colors.mutedForeground}
            />
          </View>
          <Text
            style={[
              styles.typeTitle,
              { color: isChoreChart ? colors.primary : colors.foreground },
            ]}
          >
            Chore Chart
          </Text>
          <Text style={[styles.typeDesc, { color: colors.mutedForeground }]}>
            {householdComplete
              ? "Weekly chore rotation"
              : "Finish setup to unlock"}
          </Text>
          {!householdComplete && (
            <Feather name="lock" size={16} color={colors.mutedForeground} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ checked: selectedType === "home-checklist" }}
          accessibilityLabel="Sweet Essentials"
          accessibilityHint="Track what your shared home still needs"
          style={[
            styles.typeCard,
            {
              backgroundColor:
                selectedType === "home-checklist" ? colors.accent + "12" : colors.card,
              borderColor:
                selectedType === "home-checklist" ? colors.accent : colors.border,
            },
          ]}
          onPress={() => {
            setSelectedType("home-checklist");
            setResult(null);
            setChoresAdded(0);
          }}
        >
          <View
            style={[
              styles.typeIcon,
              {
                backgroundColor:
                  selectedType === "home-checklist"
                    ? colors.accent + "20"
                    : colors.secondary,
              },
            ]}
          >
            <Feather
              name="home"
              size={24}
              color={
                selectedType === "home-checklist"
                  ? colors.accent
                  : colors.mutedForeground
              }
            />
          </View>
          <Text
            style={[
              styles.typeTitle,
              {
                color:
                  selectedType === "home-checklist"
                    ? colors.accent
                    : colors.foreground,
              },
            ]}
          >
            Sweet Essentials
          </Text>
          <Text style={[styles.typeDesc, { color: colors.mutedForeground }]}>
            Shared home checklist
          </Text>
        </TouchableOpacity>
      </View>
      {!householdComplete && (
        <View style={[styles.lockBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="lock" size={16} color={colors.mutedForeground} />
          <Text style={[styles.lockText, { color: colors.mutedForeground }]}>
            Add all roommates and mark household setup complete before building a chore chart.
          </Text>
        </View>
      )}</> : null}

      {/* ── Housing type (only for chore chart) ── */}
      {isChoreChart && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
            Your housing type
          </Text>

          <View style={styles.housingRow}>
            {[
              {
                key: "traditional",
                label: "Traditional",
                desc: "Shared room\nCommunal bathroom",
                icon: "users",
              },
              {
                key: "suite",
                label: "Suite-Style",
                desc: "Private bedroom\nEn-suite bathroom",
                icon: "home",
              },
              {
                key: "apartment",
                label: "Apartment",
                desc: "Full kitchen\nIn-unit bathroom",
                icon: "box",
              },
            ].map((h) => {
              const active = housingType === h.key;
              return (
                <TouchableOpacity
                  key={h.key}
                  style={[
                    styles.housingCard,
                    {
                      backgroundColor: active ? colors.primary + "12" : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    setHousingType(h.key as HousingType);
                    setResult(null);
                    setChoresAdded(0);
                  }}
                >
                  <View
                    style={[
                      styles.housingIcon,
                      {
                        backgroundColor: active
                          ? colors.primary + "20"
                          : colors.secondary,
                      },
                    ]}
                  >
                    <Feather
                      name={h.icon as any}
                      size={20}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                  </View>
                  <Text
                    style={[
                      styles.housingLabel,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {h.label}
                  </Text>
                  <Text
                    style={[styles.housingDesc, { color: colors.mutedForeground }]}
                  >
                    {h.desc}
                  </Text>
                  {active && (
                    <View
                      style={[styles.housingDot, { backgroundColor: colors.primary }]}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* ── Amenity sections ── */}
      {isChoreChart && housingType && (
        <View style={styles.amenityArea}>

          {/* Kitchen Setup */}
          <SectionCard
            title="Kitchen Setup"
            icon="coffee"
            cardBg={colors.card}
            cardBorder={colors.border}
            titleColor={colors.foreground}
            iconBg={colors.primary + "18"}
            accentColor={colors.primary}
          >
            <Text style={[styles.amenityHint, { color: colors.mutedForeground }]}>
              Which kitchen appliances do you share?
            </Text>
            <View style={styles.chipWrap}>
              {KITCHEN_AMENITIES.map((a) => (
                <ChipToggle
                  key={a.key}
                  label={a.label}
                  selected={kitchenAmenities.has(a.key)}
                  onToggle={() =>
                    setKitchenAmenities(toggleSet(kitchenAmenities, a.key))
                  }
                  accentColor={colors.primary}
                  borderColor={colors.border}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
              ))}
            </View>
            <CustomChoreInput
              chores={customKitchenChores}
              onAdd={(c) => setCustomKitchenChores((prev) => [...prev, c])}
              onRemove={(i) => setCustomKitchenChores((prev) => prev.filter((_, idx) => idx !== i))}
              accentColor={colors.primary}
              textColor={colors.foreground}
              mutedColor={colors.mutedForeground}
              borderColor={colors.border}
              cardBg={colors.card}
            />
          </SectionCard>

          {/* Bathroom Setup (suite + apartment) */}
          {(housingType === "suite" || housingType === "apartment") && (
            <SectionCard
              title="Bathroom Setup"
              icon="droplet"
              cardBg={colors.card}
              cardBorder={colors.border}
              titleColor={colors.foreground}
              iconBg={colors.success + "18"}
              accentColor={colors.success}
            >
              <Text style={[styles.amenityHint, { color: colors.mutedForeground }]}>
                What's in your bathroom?
              </Text>
              <View style={styles.chipWrap}>
                {BATHROOM_ITEMS.map((a) => (
                  <ChipToggle
                    key={a.key}
                    label={a.label}
                    selected={bathroomItems.has(a.key)}
                    onToggle={() =>
                      setBathroomItems(toggleSet(bathroomItems, a.key))
                    }
                    accentColor={colors.success}
                    borderColor={colors.border}
                    textColor={colors.foreground}
                    mutedColor={colors.mutedForeground}
                  />
                ))}
              </View>

              <Text
                style={[
                  styles.amenityHint,
                  { color: colors.mutedForeground, marginTop: 14 },
                ]}
              >
                Chores to add to your chart:
              </Text>
              {BATHROOM_CHORES.map((c) => (
                <CheckRow
                  key={c.key}
                  label={pointsEnabled ? `${c.label} (+${c.points} pts)` : c.label}
                  checked={bathroomChores.has(c.key)}
                  onToggle={() =>
                    setBathroomChores(toggleSet(bathroomChores, c.key))
                  }
                  accentColor={colors.success}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
              ))}
              <CustomChoreInput
                chores={customBathroomChores}
                onAdd={(c) => setCustomBathroomChores((prev) => [...prev, c])}
                onRemove={(i) => setCustomBathroomChores((prev) => prev.filter((_, idx) => idx !== i))}
                accentColor={colors.success}
                textColor={colors.foreground}
                mutedColor={colors.mutedForeground}
                borderColor={colors.border}
                cardBg={colors.card}
              />
            </SectionCard>
          )}

          {/* Living Area (apartment only) */}
          {housingType === "apartment" && (
            <SectionCard
              title="Living Area"
              icon="tv"
              cardBg={colors.card}
              cardBorder={colors.border}
              titleColor={colors.foreground}
              iconBg={colors.warning + "18"}
              accentColor={colors.warning}
            >
              <Text style={[styles.amenityHint, { color: colors.mutedForeground }]}>
                What's in your living area?
              </Text>
              <View style={styles.chipWrap}>
                {LIVING_ITEMS.map((a) => (
                  <ChipToggle
                    key={a.key}
                    label={a.label}
                    selected={livingItems.has(a.key)}
                    onToggle={() =>
                      setLivingItems(toggleSet(livingItems, a.key))
                    }
                    accentColor={colors.warning}
                    borderColor={colors.border}
                    textColor={colors.foreground}
                    mutedColor={colors.mutedForeground}
                  />
                ))}
              </View>

              <Text
                style={[
                  styles.amenityHint,
                  { color: colors.mutedForeground, marginTop: 14 },
                ]}
              >
                Chores to add to your chart:
              </Text>
              {LIVING_CHORES.map((c) => (
                <CheckRow
                  key={c.key}
                  label={pointsEnabled ? `${c.label} (+${c.points} pts)` : c.label}
                  checked={livingChores.has(c.key)}
                  onToggle={() =>
                    setLivingChores(toggleSet(livingChores, c.key))
                  }
                  accentColor={colors.warning}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
              ))}
              <CustomChoreInput
                chores={customLivingChores}
                onAdd={(c) => setCustomLivingChores((prev) => [...prev, c])}
                onRemove={(i) => setCustomLivingChores((prev) => prev.filter((_, idx) => idx !== i))}
                accentColor={colors.warning}
                textColor={colors.foreground}
                mutedColor={colors.mutedForeground}
                borderColor={colors.border}
                cardBg={colors.card}
              />
            </SectionCard>
          )}
        </View>
      )}

      {/* ── Home Essentials checklist ── */}
      {selectedType === "home-checklist" && (
        <View style={[styles.amenityArea, { marginTop: 4 }]}>
          {ESSENTIAL_CATALOG.map((section) => {
            const sectionCustom = customEssentials[section.id] ?? [];
            const coreItems = section.items.filter((entry) => entry.subsection !== "optional");
            const ownedCoreCount = coreItems.filter(
              (entry) => essentialOwned[section.id]?.[entry.id],
            ).length;
            const isExpanded = expandedSections.has(section.id);
            return (
              <View
                key={section.id}
                style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${section.title}, ${ownedCoreCount} of ${coreItems.length} core items owned`}
                  style={[styles.sectionCardHeader, isExpanded && styles.sectionCardHeaderExpanded]}
                  onPress={() => toggleExpandSection(section.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sectionCardIcon, { backgroundColor: section.color + "18" }]}>
                    <Feather name={section.icon as any} size={16} color={section.color} />
                  </View>
                  <Text style={[styles.sectionCardTitle, { color: colors.foreground, flex: 1 }]}>
                    {section.title}
                  </Text>
                  {ownedCoreCount > 0 && (
                    <View style={[styles.checkedBadge, { backgroundColor: section.color + "20" }]}>
                      <Text style={[styles.checkedBadgeText, { color: section.color }]}>
                        {ownedCoreCount}/{coreItems.length}
                      </Text>
                    </View>
                  )}
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={{ marginTop: 4 }}>
                    {(["large", "small", "optional"] as const).map((subsection) => {
                      const subsectionItems = section.items.filter(
                        (entry) => entry.subsection === subsection,
                      );
                      if (subsectionItems.length === 0) return null;
                      return (
                        <View key={subsection}>
                          <Text
                            accessibilityRole="header"
                            style={[styles.essentialSubsectionTitle, { color: colors.mutedForeground }]}
                          >
                            {ESSENTIAL_SUBSECTION_LABELS[subsection]}
                            {subsection === "optional" ? " · does not affect core progress" : ""}
                          </Text>
                          {subsectionItems.map((entry) => (
                            <EssentialItemRow
                              key={entry.id}
                              item={entry.label}
                              optional={entry.subsection === "optional"}
                              checked={Boolean(essentialOwned[section.id]?.[entry.id])}
                              shortlisted={Boolean(essentialShortlist[section.id]?.[entry.id])}
                              onToggle={() => toggleOwnedItem(section.id, entry.id)}
                              assignedUserIds={essentialsAssignees[section.id]?.[entry.id] ?? []}
                              currentUserId={currentUserId}
                              assignmentPending={pendingAssignments.has(`${section.id}:${entry.id}`)}
                              assignmentError={assignmentErrors.has(`${section.id}:${entry.id}`)}
                              onToggleSelfAssignment={(assigned) =>
                                void toggleSelfAssignment(section.id, entry.id, assigned)
                              }
                              accentColor={section.color}
                              textColor={colors.foreground}
                              mutedColor={colors.mutedForeground}
                              roommates={roommates}
                            />
                          ))}
                        </View>
                      );
                    })}
                    <CustomChoreInput
                      chores={sectionCustom}
                      onAdd={(item) => addCustomEssential(section.id, item)}
                      onRemove={(i) => removeCustomEssential(section.id, i)}
                      accentColor={section.color}
                      textColor={colors.foreground}
                      mutedColor={colors.mutedForeground}
                      borderColor={colors.border}
                      cardBg={colors.card}
                      triggerLabel="Add a custom item"
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {isChoreChart && (
        <View style={styles.preferenceSection}>
          <Text style={[styles.sectionLabel, { color: colors.foreground, marginHorizontal: 0 }]}>
            Your task preferences
          </Text>
          <Text style={[styles.preferenceIntro, { color: colors.mutedForeground }]}>
            These are saved to your member profile and help balance the chart.
          </Text>
          {PREFERENCE_DIMENSIONS.map((dimension) => {
            const preference = memberPreferences.find(
              (entry) => entry.memberId === currentUserId && entry.key === dimension.key,
            );
            return (
              <PreferenceBar
                key={dimension.key}
                label={dimension.key}
                questionText={dimension.question}
                helperText={dimension.helper}
                value={preference?.value ?? 50}
                onChange={(value) => {
                  setMemberPreference(dimension.key, value).catch(() => {
                    setError("Unable to save your task preference.");
                    hapticError();
                  });
                }}
              />
            );
          })}
        </View>
      )}

      {isChoreChart && (
        <View style={[styles.customTaskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.customTaskHeader}>
            <View>
              <Text style={[styles.customTaskTitle, { color: colors.foreground }]}>Custom tasks</Text>
              <Text style={[styles.customTaskHint, { color: colors.mutedForeground }]}>
                Difficulty defaults to 3/5 and is required.
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/task-difficulty")}>
              <Text style={[styles.editDifficultyLink, { color: colors.primary }]}>Edit item levels</Text>
            </TouchableOpacity>
          </View>
          {customTasks.map((task) => (
            <View key={task.id} style={[styles.savedCustomTask, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.savedCustomTitle, { color: colors.foreground }]}>{task.title}</Text>
                <Text style={[styles.savedCustomMeta, { color: colors.mutedForeground }]}>
                  {task.difficulty}/5 · {task.frequency} · {task.timeOfDay}
                </Text>
              </View>
              <TouchableOpacity onPress={() => deleteCustomTask(task.id)}>
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))}
          <TextInput
            value={customTaskTitle}
            onChangeText={setCustomTaskTitle}
            placeholder="Task name"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.customTaskInput, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]}
          />
          <Text style={[styles.customTaskFieldLabel, { color: colors.mutedForeground }]}>DIFFICULTY</Text>
          <View style={styles.customTaskOptions}>
            {([1, 2, 3, 4, 5] as Difficulty[]).map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setCustomTaskDifficulty(value)}
                style={[styles.customTaskChip, {
                  backgroundColor: value === customTaskDifficulty ? colors.primary : colors.muted,
                  borderColor: value === customTaskDifficulty ? colors.primary : colors.border,
                }]}
              >
                <Text style={{ color: value === customTaskDifficulty ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_700Bold" }}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.customTaskFieldLabel, { color: colors.mutedForeground }]}>FREQUENCY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customTaskOptions}>
            {(["daily", "everyOtherDay", "weekly", "biweekly", "monthly"] as ChoreFrequency[]).map((value) => (
              <TouchableOpacity key={value} onPress={() => setCustomTaskFrequency(value)} style={[styles.customTextChip, {
                backgroundColor: value === customTaskFrequency ? colors.primary : colors.muted,
                borderColor: value === customTaskFrequency ? colors.primary : colors.border,
              }]}>
                <Text style={{ color: value === customTaskFrequency ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{value}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.customTaskFieldLabel, { color: colors.mutedForeground }]}>TIME OF DAY</Text>
          <View style={styles.customTaskOptions}>
            {(["morning", "night", "any"] as ChoreTimeOfDay[]).map((value) => (
              <TouchableOpacity key={value} onPress={() => setCustomTaskTime(value)} style={[styles.customTextChip, {
                backgroundColor: value === customTaskTime ? colors.primary : colors.muted,
                borderColor: value === customTaskTime ? colors.primary : colors.border,
              }]}>
                <Text style={{ color: value === customTaskTime ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            disabled={!customTaskTitle.trim()}
            onPress={() => {
              if (!customTaskTitle.trim()) return;
              addCustomTask({
                item: customTaskTitle.trim(),
                title: customTaskTitle.trim(),
                difficulty: customTaskDifficulty,
                frequency: customTaskFrequency,
                timeOfDay: customTaskTime,
              });
              setCustomTaskTitle("");
              setCustomTaskDifficulty(3);
            }}
            style={[styles.saveCustomTask, { backgroundColor: colors.primary, opacity: customTaskTitle.trim() ? 1 : 0.5 }]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.saveCustomTaskText, { color: colors.primaryForeground }]}>Add custom task</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Error ── */}
      {error ? (
        <View style={[styles.errorBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "33" }]}>
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        </View>
      ) : null}

      {generatedTasks.length > 0 && (
        <View style={[styles.generatedTaskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.customTaskTitle, { color: colors.foreground }]}>
            Generated Tasks ({generatedTasks.length})
          </Text>
          {generatedTasks.map((task) => (
            <View key={task.id} style={[styles.generatedTaskRow, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.savedCustomTitle, { color: colors.foreground }]}>{task.title}</Text>
                <Text style={[styles.savedCustomMeta, { color: colors.mutedForeground }]}>
                  {task.item} · {task.frequency} · {task.timeOfDay}
                </Text>
              </View>
              <Text style={[styles.generatedDifficulty, { color: colors.primary }]}>{task.difficulty}/5</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Chore chart: category-section tiles ── */}
      {choreChartData ? (
        <View style={{ marginHorizontal: 16, marginTop: 12, gap: 10 }}>
          {/* Header row */}
          <View style={[styles.resultHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.resultHeaderIcon, { backgroundColor: colors.primary + "18" }]}>
              <Feather name="calendar" size={16} color={colors.primary} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>12-Week Chore Chart</Text>
            <TouchableOpacity
              onPress={() => { setChoreChartData(null); setChoresAdded(0); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* One card per chore category */}
          {getActiveSlots(choreChartData).map((slot) => {
            const weeks = choreChartData.weeks.filter((e) => !!e.assignments[slot.key]);
            if (weeks.length === 0) return null;
            const visual = slotVisualFor(slot.key);
            return (
              <View key={slot.key} style={[styles.slotSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Section header */}
                <View style={styles.slotHeader}>
                  <View style={[styles.slotIcon, { backgroundColor: visual.color + "18" }]}>
                    <Feather name={visual.icon} size={14} color={visual.color} />
                  </View>
                  <Text style={[styles.slotLabel, { color: colors.foreground }]}>{slot.label}</Text>
                </View>
                {/* Week tiles — horizontal scroll */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, gap: 8 }}
                >
                  {weeks.map((entry) => {
                    const personName = entry.assignments[slot.key]!;
                    const roommate = roommates.find((r) => r.name === personName);
                    const chipColor = roommate?.color ?? visual.color;
                    return (
                      <View key={entry.week} style={[styles.weekTile, { borderColor: chipColor + "44", backgroundColor: chipColor + "10" }]}>
                        <Text style={[styles.weekTileNum, { color: colors.mutedForeground }]}>Wk {entry.week}</Text>
                        <View style={[styles.weekTileDot, { backgroundColor: chipColor }]} />
                        <Text style={[styles.weekTileName, { color: chipColor }]} numberOfLines={1}>{personName}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })}

          {/* Fairness note */}
          {choreChartData.fairness_note ? (
            <View style={[styles.fairnessNote, { backgroundColor: colors.success + "10", borderColor: colors.success + "30" }]}>
              <Feather name="shield" size={13} color={colors.success} />
              <Text style={[styles.fairnessNoteText, { color: colors.mutedForeground }]}>{choreChartData.fairness_note}</Text>
            </View>
          ) : null}

          {/* Chores added banner */}
          {choresAdded > 0 ? (
            <View style={[styles.successBanner, { backgroundColor: colors.success + "14", borderColor: colors.success + "44" }]}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.successText, { color: colors.success }]}>
                {choresAdded} chore{choresAdded !== 1 ? "s" : ""} added to My Sweet!
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Home checklist / fallback text result ── */}
      {result ? (
        <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.resultHeaderRow}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>
              Your {selectedType === "chore-chart" ? "Chore Chart" : "Sweet Checklist"}
            </Text>
            <TouchableOpacity onPress={() => { setResult(null); setChoresAdded(0); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.resultText, { color: colors.foreground }]}>{result}</Text>
        </View>
      ) : null}
    </ScrollView>

    <Modal
      visible={shortlistOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShortlistOpen(false)}
    >
      <View style={[styles.shortlistScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.shortlistHeader, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.shortlistTitle, { color: colors.foreground }]}>Shortlist Items</Text>
            <Text style={[styles.shortlistHelper, { color: colors.mutedForeground }]}>
              Choose what your Sweet still wants to obtain. Owned items and optional items start unselected.
            </Text>
            {essentialShortlistUpdatedBy ? (
              <Text style={[styles.shortlistUpdatedBy, { color: colors.mutedForeground }]}>
                Last updated by {roommates.find((entry) => entry.id === essentialShortlistUpdatedBy)?.name ?? "a Sweetmate"}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => setShortlistOpen(false)}
            accessibilityLabel="Close shortlist"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.shortlistScroll} contentContainerStyle={styles.shortlistContent}>
          {recommendations.length > 0 ? (
            <View style={[styles.recommendationBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shortlistCount, { color: colors.foreground }]}>
                  Suggested based on your space
                </Text>
                <Text style={[styles.shortlistHelper, { color: colors.mutedForeground }]}>
                  {recommendations.length} chore-related essentials. Suggestions stay unselected until you choose them.
                </Text>
              </View>
              <TouchableOpacity
                onPress={selectRecommendedItems}
                accessibilityRole="button"
                accessibilityLabel="Select recommended Sweet Essentials"
              >
                <Text style={[styles.shortlistAction, { color: colors.primary }]}>
                  Select recommended
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {ESSENTIAL_CATALOG.map((category) => (
            <View
              key={category.id}
              style={[styles.shortlistCategory, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text accessibilityRole="header" style={[styles.sectionCardTitle, { color: colors.foreground }]}>
                {category.title}
              </Text>
              {(["large", "small", "optional"] as const).map((subsection) => {
                const subsectionItems = category.items.filter(
                  (entry) => entry.subsection === subsection,
                );
                if (!subsectionItems.length) return null;
                return (
                  <View key={subsection}>
                    <View style={styles.shortlistSubsectionHeader}>
                      <Text style={[styles.essentialSubsectionTitle, { color: colors.mutedForeground, flex: 1 }]}>
                        {ESSENTIAL_SUBSECTION_LABELS[subsection]}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setDraftSubsection(category.id, subsection, true)}
                        accessibilityLabel={`Select all ${category.title} ${ESSENTIAL_SUBSECTION_LABELS[subsection]}`}
                      >
                        <Text style={[styles.shortlistAction, { color: colors.primary }]}>Select all</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setDraftSubsection(category.id, subsection, false)}
                        accessibilityLabel={`Clear all ${category.title} ${ESSENTIAL_SUBSECTION_LABELS[subsection]}`}
                      >
                        <Text style={[styles.shortlistAction, { color: colors.mutedForeground }]}>Clear</Text>
                      </TouchableOpacity>
                    </View>
                    {subsectionItems.map((entry) => {
                      const selected = Boolean(shortlistDraft[category.id]?.[entry.id]);
                      const owned = Boolean(essentialOwned[category.id]?.[entry.id]);
                      return (
                        <TouchableOpacity
                          key={entry.id}
                          style={styles.shortlistRow}
                          onPress={() => setDraftItem(category.id, entry.id, !selected)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${selected ? "Remove" : "Add"} ${entry.label} ${selected ? "from" : "to"} shortlist${owned ? ", already owned" : ""}`}
                        >
                          <Feather
                            name={selected ? "check-square" : "square"}
                            size={18}
                            color={selected ? category.color : colors.mutedForeground}
                          />
                          <Text style={[styles.checkLabel, { color: owned ? colors.mutedForeground : colors.foreground, flex: 1 }]}>
                            {entry.label}
                          </Text>
                          <Text style={[styles.shortlistStatus, { color: colors.mutedForeground }]}>
                            {owned
                              ? "Owned"
                              : recommendedKeys.has(`${category.id}:${entry.id}`)
                                ? "Recommended"
                                : subsection === "optional"
                                  ? "Optional"
                                  : "Available"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={[styles.shortlistFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[styles.shortlistCount, { color: colors.foreground }]}>
            {shortlistSelectedCount} selected
          </Text>
          <Text style={[styles.shortlistHelper, { color: colors.mutedForeground }]}>
            Save your shortlist for your household. Add selected items to category-based Shopping lists when you’re ready.
          </Text>
          {shortlistSaveMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.shortlistHelper,
                {
                  color: shortlistSaveMessage.startsWith("Couldn’t")
                    ? colors.destructive
                    : colors.success,
                },
              ]}
            >
              {shortlistSaveMessage}
            </Text>
          ) : null}
          {shortlistTransferMessage ? (
            <View style={styles.shortlistTransferFeedback}>
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.shortlistHelper,
                  styles.shortlistTransferMessage,
                  {
                    color: shortlistTransferMessage.startsWith("Couldn’t")
                      ? colors.destructive
                      : colors.success,
                  },
                ]}
              >
                {shortlistTransferMessage}
              </Text>
              {!shortlistTransferMessage.startsWith("Couldn’t") ? (
                <TouchableOpacity
                  onPress={() => router.push("/(tabs)/shopping")}
                  accessibilityRole="button"
                  accessibilityLabel="View added essentials in Shopping"
                >
                  <Text style={[styles.shortlistAction, { color: colors.primary }]}>
                    View in Shopping
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <View style={styles.shortlistButtons}>
            <TouchableOpacity
              disabled={shortlistTransferLoading || shortlistSaving || shortlistSelectedCount === 0}
              onPress={addSelectedToShopping}
              style={[
                styles.shortlistSave,
                styles.shortlistSecondary,
                {
                  borderColor: colors.primary,
                  opacity: shortlistTransferLoading || shortlistSaving || shortlistSelectedCount === 0 ? 0.6 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add selected Sweet Essentials to Shopping"
              accessibilityState={{ busy: shortlistTransferLoading }}
            >
              {shortlistTransferLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.shortlistSecondaryText, { color: colors.primary }]}>
                  Add Selected to Shopping
                </Text>
              )}
            </TouchableOpacity>
          {setupMode ? (
          <TouchableOpacity
            disabled={shortlistSaving || shortlistTransferLoading}
            onPress={() => void continueHouseholdSetup()}
            style={[styles.shortlistSave, { backgroundColor: colors.primary, opacity: shortlistSaving || shortlistTransferLoading ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save selected essentials and continue household setup"
          >
            {shortlistSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Continue setup</Text>}
          </TouchableOpacity>
          ) :
          <TouchableOpacity
            disabled={shortlistSaving || shortlistTransferLoading}
            onPress={() => void saveShortlist()}
            style={[styles.shortlistSave, { backgroundColor: colors.primary, opacity: shortlistSaving || shortlistTransferLoading ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save shortlist"
          >
            {shortlistSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Save Shortlist</Text>}
          </TouchableOpacity>
          }
          </View>
        </View>
      </View>
    </Modal>

    {/* ── Sticky bottom button area ── */}
    <View style={[styles.stickyBottom, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: botPad + 16 }]}>
      {/* Add Tasks button — shown after chart is generated */}
      {choreChartData && choresAdded === 0 ? (
        <Pressable
          style={[styles.addTasksBtn, { backgroundColor: colors.success }]}
          onPress={addTasks}
        >
          <Feather name="plus-circle" size={18} color="#fff" />
          <Text style={styles.generateText}>Add Tasks to My Sweet</Text>
        </Pressable>
      ) : null}

      {/* Build / Generate button */}
      {!choreChartData && (
        <Pressable
          style={[styles.generateBtn, { backgroundColor: canGenerate && !loading ? colors.primary : colors.muted }]}
          disabled={!canGenerate || loading}
          onPress={generate}
          accessibilityRole="button"
          accessibilityLabel={selectedType === "home-checklist" ? "Shortlist items" : "Build chore chart"}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              {isChoreChart ? <Feather name="zap" size={18} color="#fff" /> : null}
              <Text style={styles.generateText}>
                {isChoreChart
                  ? "Build Chore Chart"
                  : selectedType === "home-checklist"
                  ? "Shortlist Items"
                  : "Generate"}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* Rebuild button — shown after chart exists */}
      {choreChartData ? (
        <Pressable
          style={[styles.rebuildBtn, { borderColor: colors.border }]}
          onPress={generate}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color={colors.mutedForeground} size="small" /> : (
            <>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
              <Text style={[styles.rebuildText, { color: colors.mutedForeground }]}>Rebuild Chart</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
    </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 28 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 4 },

  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 8,
  },

  // ── Type cards ──
  typeRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  typeCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 142,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  typeIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  typeTitle: { fontFamily: "Inter_700Bold", fontSize: 14, textAlign: "center" },
  typeDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15,
  },

  // ── Housing cards ──
  housingRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  housingCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 2,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  housingIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  housingLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    textAlign: "center",
  },
  housingDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 9,
    textAlign: "center",
    lineHeight: 13,
  },
  housingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
  },

  // ── Amenity sections ──
  amenityArea: { paddingHorizontal: 16, gap: 12, marginBottom: 4 },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  sectionCardHeaderExpanded: { marginBottom: 8 },
  sectionCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCardTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  essentialSubsectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 5,
  },
  shortlistScreen: { flex: 1 },
  shortlistHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  shortlistTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  shortlistHelper: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, marginTop: 4 },
  shortlistUpdatedBy: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 5 },
  shortlistScroll: { flex: 1 },
  shortlistContent: { padding: 16, gap: 12 },
  recommendationBanner: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  shortlistCategory: { borderWidth: 1, borderRadius: 16, padding: 14 },
  shortlistSubsectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  shortlistAction: { fontFamily: "Inter_600SemiBold", fontSize: 12, paddingVertical: 8 },
  shortlistRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  shortlistStatus: { fontFamily: "Inter_500Medium", fontSize: 11 },
  shortlistFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 8,
  },
  shortlistCount: { fontFamily: "Inter_700Bold", fontSize: 14 },
  shortlistTransferFeedback: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  shortlistTransferMessage: { flex: 1 },
  shortlistButtons: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 10 },
  shortlistSave: { flex: 1, minWidth: 150, minHeight: 48, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  shortlistSecondary: { borderWidth: 1, backgroundColor: "transparent" },
  shortlistSecondaryText: { fontFamily: "Inter_700Bold", fontSize: 13, textAlign: "center" },
  amenityHint: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginBottom: 10,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 12 },

  // ── Checkboxes ──
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },

  // ── Inputs ──
  textarea: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  customTaskCard: { marginHorizontal: 16, marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  preferenceSection: { marginHorizontal: 16, marginTop: 14, gap: 10 },
  preferenceIntro: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: -7 },
  customTaskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  customTaskTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  customTaskHint: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  editDifficultyLink: { fontFamily: "Inter_700Bold", fontSize: 12 },
  savedCustomTask: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center" },
  savedCustomTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  savedCustomMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  customTaskInput: { height: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 15 },
  customTaskFieldLabel: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1, marginTop: 2 },
  customTaskOptions: { flexDirection: "row", gap: 7 },
  customTaskChip: { flex: 1, height: 36, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  customTextChip: { minHeight: 36, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  saveCustomTask: { height: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  saveCustomTaskText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  generatedTaskCard: { marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 18, padding: 14 },
  generatedTaskRow: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  generatedDifficulty: { fontFamily: "Inter_700Bold", fontSize: 15 },

  // ── Generate button ──
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  generateText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
  lockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  lockText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 17 },

  // ── Banners ──
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  successText: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
  checkedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: 6,
  },
  checkedBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 },

  // ── Result card (home checklist / fallback) ──
  resultCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  resultHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  resultTitle: { fontFamily: "Inter_700Bold", fontSize: 15, flex: 1 },
  resultText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
  },

  // ── Chore chart structured output ──
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  resultHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  slotSection: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  slotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  slotIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  slotLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  weekTile: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
    minWidth: 72,
  },
  weekTileNum: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  weekTileDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  weekTileName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textAlign: "center",
  },
  fairnessNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  fairnessNoteText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },

  // ── Sticky bottom ──
  stickyBottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  addTasksBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  rebuildBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  rebuildText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
});
