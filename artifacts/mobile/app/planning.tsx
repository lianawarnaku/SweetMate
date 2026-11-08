import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
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

import { useAppContext, type ProposedChart, type Roommate } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { error as hapticError } from "@/lib/haptics";
import type { ChoreFrequency, ChoreTimeOfDay } from "@/constants/choreRules";
import type { Difficulty } from "@/lib/itemDifficulty";
import { generateHouseholdTasks, parseHouseholdAmenities } from "@/lib/taskGenerator";
import { PreferenceBar } from "@/components/PreferenceBar";
import { buildHouseholdChart, frequencyLabel } from "@/lib/choreChart";
import { choreNow } from "@/lib/choreClock";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";
import {
  ESSENTIAL_CATALOG,
  ESSENTIAL_SUBSECTION_LABELS,
  type EssentialSubsection,
} from "@/constants/essentialCatalog";
import { track } from "@/lib/analytics";
import { essentialRecommendationsForHousingType } from "@/lib/essentialRecommendations";

type PlanType = "chore-chart" | "home-checklist" | null;

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
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
  triggerText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
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
  errorColor,
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
  errorColor: string;
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
              <Text style={[essentialRowStyles.assignmentError, { color: errorColor }]}>
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
  assignLabel: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12, lineHeight: 16 },
  assignmentError: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 11, marginTop: 2 },
  selfAssignButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1,
  },
  selfAssignText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 },
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
    roommates, chores, householdTimezone, itemDifficulties, currentProposedChart, proposeChart, essentialsAssignees, setEssentialSelfAssignment,
    essentialOwned, essentialShortlist, essentialShortlistUpdatedBy,
    setEssentialOwned, saveEssentialShortlist, addSelectedEssentialsToShopping,
    pointsEnabled, householdComplete, householdId, homeProfile, customTasks,
    addCustomTask, deleteCustomTask, memberPreferences, setMemberPreference,
    currentUserId, setHouseholdSetupStep, choreChartConfigurationReady, retryChoreChartConfiguration,
    shoppingLists, shoppingItems,
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
  const [checkedEssentials, setCheckedEssentials] = useState<Record<string, Set<string>>>({});
  const [customEssentials, setCustomEssentials] = useState<Record<string, string[]>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [shoppingPreviewOpen, setShoppingPreviewOpen] = useState(false);
  const [shortlistDraft, setShortlistDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [result, setResult] = useState<string | null>(null);
  const [chartDraft, setChartDraft] = useState<ProposedChart["payload"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftInputs = JSON.stringify([homeProfile, customTasks, itemDifficulties, memberPreferences, roommates.map((member) => member.id), chores, currentProposedChart?.id]);
  useEffect(() => { setChartDraft(null); }, [draftInputs]);
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
  const allRecommendedSelected =
    recommendations.length > 0 &&
    recommendations.every(
      ({ categoryId, itemId }) => shortlistDraft[categoryId]?.[itemId],
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
      // Dismiss the Essentials sheet before navigating. `router.replace` only
      // swaps the screen *behind* a presented pageSheet, so leaving it open
      // makes step 4 invisible and the button look dead.
      setShoppingPreviewOpen(false);
      setShortlistOpen(false);
      router.replace("/sweet-setup" as never);
    } catch (setupError) {
      reportRuntimeError("continue household setup", setupError);
      setError("We couldn't continue setup. Your selected items are still saved.");
    } finally {
      continuingSetupRef.current = false;
    }
  }

  // ── Build + create chores ────────────────────────────────────────────────
  // Each chore *group* (Bathroom Heavy etc.) is expanded into the individual
  // tasks it covers, so the user sees them as separate to-dos in My Home and
  // the Group tab.
  const generate = async () => {
    if (!selectedType) return;
    if (selectedType === "chore-chart" && !householdComplete) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setChartDraft(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (selectedType === "chore-chart") {
        if (!choreChartConfigurationReady) throw new Error("Wait for your saved chore settings to load before previewing a chart.");
        if (!householdId || !homeProfile) {
          throw new Error("Complete household setup before generating tasks.");
        }
        const tasks = await generateHouseholdTasks(
          householdId,
          parseHouseholdAmenities(homeProfile.items).flatMap((amenity) => {
            const count = Math.max(1, homeProfile.roomCounts?.[amenity.category] ?? 1);
            return Array.from({ length: count }, (_, index) => ({
              ...amenity,
              roomInstanceId: `${amenity.category}-${index + 1}`,
            }));
          }),
          homeProfile.housingType,
          customTasks,
          itemDifficulties.filter((entry) => entry.householdId === householdId),
        );
        const includedTasks = tasks.filter((task) => !(homeProfile.removedGeneratedKeys ?? []).includes(task.id))
          .map((task) => ({ ...task, frequency: homeProfile.recurrenceOverrides?.[task.id] ?? task.frequency }));
        setChartDraft(buildHouseholdChart({
          tasks: includedTasks, members: roommates, preferences: memberPreferences.filter((entry) => entry.householdId === householdId), chores,
          householdId, now: choreNow(), timezone: householdTimezone, previous: currentProposedChart?.payload,
        }));
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

  const sendChartForApproval = async () => {
    if (!chartDraft) return;
    setLoading(true);
    setError(null);
    try {
      await proposeChart(chartDraft);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push("/alerts");
    } catch (failure) {
      setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Unable to send the chart. Please try again.");
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const isChoreChart = selectedType === "chore-chart";
  const canGenerate =
    selectedType !== null &&
    (selectedType === "home-checklist" || (isChoreChart && householdComplete && choreChartConfigurationReady && homeProfile !== null && roommates.length > 0));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={KEYBOARD_BEHAVIOR}
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
            accessibilityRole="button"
            accessibilityLabel={setupMode ? "Back from Sweet Essentials" : "Back from Planning Helper"}
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
            setChartDraft(null);
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
              ? "Recurring chore assignments"
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
            setChartDraft(null);
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
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Finish household setup"
            accessibilityHint="Opens household settings"
            onPress={() => router.push("/settings")}
            style={[styles.finishSetupButton, { backgroundColor: colors.action }]}
          >
            <Text style={[styles.finishSetupText, { color: colors.actionForeground }]}>Finish setup</Text>
            <Feather name="arrow-right" size={15} color={colors.actionForeground} />
          </TouchableOpacity>
        </View>
      )}</> : null}

      {isChoreChart && !choreChartConfigurationReady && <View style={[styles.customTaskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.preferenceIntro, { color: colors.mutedForeground }]}>Your saved chore settings must finish loading before a chart can be built.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading chore settings" style={{ minHeight: 44, justifyContent: "center" }} onPress={() => void retryChoreChartConfiguration().catch((error) => setError(error instanceof Error ? error.message : "Unable to load chore settings."))}>
          <Text style={[styles.savedCustomTitle, { color: colors.primary }]}>Retry loading</Text>
        </TouchableOpacity>
      </View>}
      {isChoreChart && homeProfile && (
        <View style={[styles.customTaskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.customTaskTitle, { color: colors.foreground }]}>Your household</Text>
          <Text style={[styles.preferenceIntro, { color: colors.mutedForeground }]}>
            Uses the features and room counts saved during household setup, plus your custom tasks and saved item difficulty levels.
          </Text>
          <Text style={[styles.savedCustomMeta, { color: colors.foreground }]}>
            {homeProfile.housingType} · {homeProfile.items.length} selected features
          </Text>
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
                              errorColor={colors.destructive}
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
            Preferences help choose starting assignments. Recurring chores then rotate among eligible Sweetmates. Use “Always me” or “Never me” during approval for a firm rule.
          </Text>
          {PREFERENCE_DIMENSIONS.map((dimension) => {
            const preference = memberPreferences.find(
              (entry) => entry.householdId === householdId && entry.memberId === currentUserId && entry.key === dimension.key,
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
                  backgroundColor: value === customTaskDifficulty ? colors.action : colors.muted,
                  borderColor: value === customTaskDifficulty ? colors.primary : colors.border,
                }]}
              >
                <Text style={{ color: value === customTaskDifficulty ? colors.actionForeground : colors.mutedForeground, fontFamily: "Inter_700Bold" }}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.customTaskFieldLabel, { color: colors.mutedForeground }]}>FREQUENCY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customTaskOptions}>
            {(["daily", "everyOtherDay", "everyThreeDays", "weekly", "biweekly", "monthly"] as ChoreFrequency[]).map((value) => (
              <TouchableOpacity key={value} onPress={() => setCustomTaskFrequency(value)} style={[styles.customTextChip, {
                backgroundColor: value === customTaskFrequency ? colors.action : colors.muted,
                borderColor: value === customTaskFrequency ? colors.primary : colors.border,
              }]}>
                <Text style={{ color: value === customTaskFrequency ? colors.actionForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 }}>{frequencyLabel(value)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.customTaskFieldLabel, { color: colors.mutedForeground }]}>TIME OF DAY</Text>
          <View style={styles.customTaskOptions}>
            {(["morning", "night", "any"] as ChoreTimeOfDay[]).map((value) => (
              <TouchableOpacity key={value} onPress={() => setCustomTaskTime(value)} style={[styles.customTextChip, {
                backgroundColor: value === customTaskTime ? colors.action : colors.muted,
                borderColor: value === customTaskTime ? colors.primary : colors.border,
              }]}>
                <Text style={{ color: value === customTaskTime ? colors.actionForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 }}>{value}</Text>
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
            style={[styles.saveCustomTask, { backgroundColor: colors.action, opacity: customTaskTitle.trim() ? 1 : 0.5 }]}
          >
            <Feather name="plus" size={16} color={colors.actionForeground} />
            <Text style={[styles.saveCustomTaskText, { color: colors.actionForeground }]}>Add custom task</Text>
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

      {isChoreChart && chartDraft && (
        <View style={[styles.generatedTaskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.customTaskTitle, { color: colors.foreground }]}>Proposed starting assignments</Text>
          <Text style={[styles.preferenceIntro, { color: colors.mutedForeground, marginTop: 8 }]}>
            Workload combines difficulty and how often chores recur, including retained unfinished work. Rotating chores change assignee each occurrence. Changes begin with upcoming chores after approval; completed history, overdue work and manual assignments are retained.
          </Text>
          {chartDraft.assignments.map((assignment) => (
            <View key={assignment.memberId} style={{ marginTop: 16 }}>
              <Text accessibilityRole="header" style={[styles.savedCustomTitle, { color: colors.foreground }]}>
                {roommates.find((member) => member.id === assignment.memberId)?.name ?? "Sweetmate"} · {assignment.totalLoad.toFixed(1)} weighted workload
              </Text>
              {assignment.taskIds.length === 0 && <Text style={[styles.savedCustomMeta, { color: colors.mutedForeground }]}>No new starting assignments</Text>}
              {assignment.taskIds.map((taskId) => {
                const task = chartDraft.generatedTasks?.find((entry) => entry.id === taskId);
                if (!task) return null;
                return <View key={task.id} style={[styles.generatedTaskRow, { borderTopColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.savedCustomTitle, { color: colors.foreground }]}>{task.title}</Text>
                    <Text style={[styles.savedCustomMeta, { color: colors.mutedForeground }]}>
                      {frequencyLabel(task.frequency)} · {task.timeOfDay} · {task.difficulty}/5 difficulty{chartDraft.manualAssignmentTaskIds?.includes(task.id) ? " · manual schedule" : chartDraft.pinnedAssignments?.[task.id] ? " · fixed assignee" : " · rotates"}
                    </Text>
                  </View>
                </View>;
              })}
            </View>
          ))}
        </View>
      )}

      {/* ── Home checklist / fallback text result ── */}
      {result ? (
        <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.resultHeaderRow}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>
              Your {selectedType === "chore-chart" ? "Chore Chart" : "Sweet Checklist"}
            </Text>
            <TouchableOpacity onPress={() => { setResult(null); setChartDraft(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
          {recommendations.length > 0 && !allRecommendedSelected ? (
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
        <View style={[styles.shortlistFooter, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
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
                  onPress={() => {
                    if (setupMode) {
                      setShoppingPreviewOpen(true);
                      return;
                    }
                    setShortlistOpen(false);
                    router.push("/(tabs)/shopping" as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    setupMode
                      ? "Preview added essentials in Shopping"
                      : "View added essentials in Shopping"
                  }
                >
                  <Text style={[styles.shortlistAction, { color: colors.primary }]}>
                    {setupMode ? "Preview in Shopping" : "View in Shopping"}
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
            style={[styles.shortlistSave, { backgroundColor: colors.action, opacity: shortlistSaving || shortlistTransferLoading ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save selected essentials and continue household setup"
          >
            {shortlistSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Continue setup</Text>}
          </TouchableOpacity>
          ) :
          <TouchableOpacity
            disabled={shortlistSaving || shortlistTransferLoading}
            onPress={() => void saveShortlist()}
            style={[styles.shortlistSave, { backgroundColor: colors.action, opacity: shortlistSaving || shortlistTransferLoading ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Save shortlist"
          >
            {shortlistSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Save Shortlist</Text>}
          </TouchableOpacity>
          }
          </View>
        </View>
      </View>

      {/* Read-only Shopping preview, layered over the shortlist during setup.
          Nested inside the shortlist Modal so dismissing it reveals the
          shortlist exactly as the user left it. */}
      <Modal
        visible={shoppingPreviewOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShoppingPreviewOpen(false)}
      >
        <View style={[styles.shortlistScreen, { backgroundColor: colors.background }]}>
          <View style={[styles.shortlistHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShoppingPreviewOpen(false)}
              style={styles.previewBackRow}
              accessibilityRole="button"
              accessibilityLabel="Back to Shortlist Items"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={22} color={colors.primary} />
              <Text style={[styles.shortlistAction, { color: colors.primary }]}>
                Shortlist Items
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.shortlistHeader, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.shortlistTitle, { color: colors.foreground }]}>Shopping</Text>
              <Text style={[styles.shortlistHelper, { color: colors.mutedForeground }]}>
                Preview only — a look at where your essentials landed. You can edit these lists
                from the Shopping tab once setup is done.
              </Text>
            </View>
          </View>

          <ScrollView style={styles.shortlistScroll} contentContainerStyle={styles.shortlistContent}>
            {shoppingLists.length === 0 ? (
              <View style={[styles.previewEmpty, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="shopping-cart" size={22} color={colors.mutedForeground} />
                <Text style={[styles.shortlistCount, { color: colors.foreground }]}>
                  No Shopping lists yet
                </Text>
                <Text style={[styles.shortlistHelper, { color: colors.mutedForeground, textAlign: "center" }]}>
                  Add selected essentials to Shopping and they'll show up here.
                </Text>
              </View>
            ) : (
              <>
                <View style={[styles.recommendationBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
                  <Feather name="shopping-cart" size={14} color={colors.primary} />
                  <Text style={[styles.shortlistAction, { color: colors.primary, flex: 1 }]}>
                    {shoppingItems.filter((entry) => !entry.completed).length} items left across{" "}
                    {shoppingLists.length} {shoppingLists.length === 1 ? "list" : "lists"}
                  </Text>
                </View>

                {shoppingLists.map((list) => {
                  const items = shoppingItems.filter((entry) => entry.listId === list.id);
                  const doneCount = items.filter((entry) => entry.completed).length;
                  return (
                    <View
                      key={list.id}
                      style={[styles.shortlistCategory, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={styles.previewListHeader}>
                        <Text style={[styles.previewListName, { color: colors.foreground }]} numberOfLines={1}>
                          {list.name}
                        </Text>
                        <Text style={[styles.previewListCount, { color: colors.mutedForeground }]}>
                          {doneCount}/{items.length}
                        </Text>
                      </View>
                      {items.length === 0 ? (
                        <Text style={[styles.previewItemMeta, { color: colors.mutedForeground }]}>
                          No items in this list yet.
                        </Text>
                      ) : (
                        items.map((entry) => (
                          <View key={entry.id} style={styles.previewItem}>
                            <Feather
                              name={entry.completed ? "check-circle" : "circle"}
                              size={17}
                              color={entry.completed ? colors.success : colors.border}
                            />
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.previewItemName,
                                  {
                                    color: colors.foreground,
                                    textDecorationLine: entry.completed ? "line-through" : "none",
                                  },
                                ]}
                                numberOfLines={1}
                              >
                                {entry.name}
                              </Text>
                              {entry.quantity ? (
                                <Text style={[styles.previewItemMeta, { color: colors.mutedForeground }]}>
                                  {entry.quantity}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ))
                      )}
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>

          <View style={[styles.shortlistFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShoppingPreviewOpen(false)}
              style={[styles.shortlistSave, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Back to Shortlist Items"
            >
              <Text style={styles.generateText}>Back to Shortlist Items</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>

    {/* ── Sticky bottom button area ── */}
    <View style={[styles.stickyBottom, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: botPad + 16 }]}>
      <Pressable
        style={[styles.generateBtn, { backgroundColor: canGenerate && !loading ? colors.action : colors.muted }]}
        disabled={!canGenerate || loading}
        onPress={isChoreChart && chartDraft ? sendChartForApproval : generate}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canGenerate || loading, busy: loading }}
        accessibilityLabel={isChoreChart ? chartDraft ? "Send chart for approval" : "Preview chore chart" : "Shortlist items"}
      >
        {loading ? <ActivityIndicator color={colors.actionForeground} /> : <>
          <Feather name={isChoreChart && chartDraft ? "send" : "list"} size={18} color={colors.actionForeground} />
          <Text style={[styles.generateText, { color: colors.actionForeground }]}>
            {isChoreChart ? chartDraft ? "Send for approval" : "Preview chore chart" : "Shortlist Items"}
          </Text>
        </>}
      </Pressable>
      {isChoreChart && chartDraft ? <Pressable
        style={[styles.rebuildBtn, { borderColor: colors.border, minHeight: 44 }]}
        accessibilityRole="button" accessibilityLabel="Rebuild preview"
        onPress={generate} disabled={loading}
      ><Text style={[styles.rebuildText, { color: colors.foreground }]}>Rebuild preview</Text></Pressable> : null}
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
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 28 },
  subtitle: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 14, marginTop: 4 },

  sectionLabel: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
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
  typeTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 14, textAlign: "center" },
  typeDesc: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 11,
    textAlign: "center",
  },
  housingDesc: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
  sectionCardTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },
  essentialSubsectionTitle: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
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
  shortlistTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 22 },
  shortlistHelper: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, lineHeight: 18, marginTop: 4 },
  shortlistUpdatedBy: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12, marginTop: 5 },
  shortlistScroll: { flex: 1 },
  shortlistContent: { padding: 16, gap: 12 },
  recommendationBanner: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  shortlistCategory: { borderWidth: 1, borderRadius: 16, padding: 14 },
  shortlistSubsectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  shortlistAction: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12, paddingVertical: 8 },
  shortlistRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  shortlistStatus: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 11 },
  shortlistFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 8,
  },
  shortlistCount: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 14 },
  shortlistTransferFeedback: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  shortlistTransferMessage: { flex: 1 },
  shortlistButtons: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 10 },
  previewBackRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  previewEmpty: { borderWidth: 1, borderRadius: 16, padding: 24, alignItems: "center", gap: 8 },
  previewListHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  previewListName: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  previewListCount: { fontFamily: "Inter_400Regular", fontSize: 12 },
  previewItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  previewItemName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  previewItemMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 },
  shortlistSave: { flex: 1, minWidth: 150, minHeight: 48, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  shortlistSecondary: { borderWidth: 1, backgroundColor: "transparent" },
  shortlistSecondaryText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 13, textAlign: "center" },
  amenityHint: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
  chipText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },

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
  checkLabel: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, flex: 1 },

  // ── Inputs ──
  textarea: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  customTaskCard: { marginHorizontal: 16, marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  preferenceSection: { marginHorizontal: 16, marginTop: 14, gap: 10 },
  preferenceIntro: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, marginTop: -7 },
  customTaskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  customTaskTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 18 },
  customTaskHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 2 },
  editDifficultyLink: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },
  savedCustomTask: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center" },
  savedCustomTitle: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 14 },
  savedCustomMeta: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 2 },
  customTaskInput: { height: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 15 },
  customTaskFieldLabel: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 11, letterSpacing: 1, marginTop: 2 },
  customTaskOptions: { flexDirection: "row", gap: 7 },
  customTaskChip: { flex: 1, height: 36, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  customTextChip: { minHeight: 36, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  saveCustomTask: { height: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  saveCustomTaskText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 14 },
  generatedTaskCard: { marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 18, padding: 14 },
  generatedTaskRow: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  generatedDifficulty: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },

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
  generateText: { color: "#fff", fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },
  lockBanner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  lockText: { flex: 1, fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 13, lineHeight: 17 },
  finishSetupButton: {
    minHeight: 38,
    marginLeft: 24,
    paddingHorizontal: 13,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  finishSetupText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },

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
  successText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13, flex: 1 },
  checkedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: 6,
  },
  checkedBadgeText: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
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
  errorText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 13, flex: 1 },

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
  resultTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15, flex: 1 },
  resultText: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
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
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 11,
  },
  weekTileDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  weekTileName: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
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
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 14,
  },
});
