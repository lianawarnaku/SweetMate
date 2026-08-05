import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { type HousingType, useAppContext } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { reportSupabaseError, reportRuntimeError } from "@/lib/runtimeDiagnostics";
import { error as hapticError } from "@/lib/haptics";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  buildFeatureChorePlan,
  normalizeFeatureId,
  type PersistedRecurrence,
} from "@/constants/featureChoreRegistry";
import type { ChoreCategory } from "@/context/AppContext";
import {
  householdSetupStepNumber,
  type HouseholdSetupStep,
} from "@/lib/householdSetup";

const COLORS = ["#7B563B", "#A66A3F", "#C58B57", "#7D8B6A", "#B36A6A", "#8C6D80"];
const makeInviteCode = () => Crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
const HOUSING: { key: HousingType; label: string; description: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "traditional", label: "Regular dorm", description: "Shared room and communal bathroom", icon: "users" },
  { key: "suite", label: "Suite-style", description: "Private rooms with an en-suite bathroom", icon: "home" },
  { key: "apartment", label: "Apartment", description: "Full kitchen, bathroom, and living area", icon: "grid" },
];
const ITEM_SECTIONS = [
  { key: "kitchen", title: "Kitchen", icon: "coffee", items: ["Mini fridge", "Trash can", "Microwave", "Kettle", "Floor", "Coffee machine", "Dishwasher", "Stove"] },
  { key: "bathroom", title: "Bathroom", icon: "droplet", items: ["Bathroom sink", "Mirror", "Shower", "Bathtub", "Toilet", "Bath mat", "Floor", "Trash can"] },
  { key: "living", title: "Living Space", icon: "home", items: ["Trash can", "Vacuum", "Laundry basket", "Washing machine", "Dryer"] },
  { key: "bedroom", title: "Bedrooms", icon: "moon", items: ["Carpet", "Bed linens"] },
  { key: "other", title: "Other", icon: "more-horizontal", items: ["Floor", "Trash can"] },
] as const;

export function HouseholdSetupScreen({
  onComplete,
  initialMode = "create",
  additionalHousehold = false,
}: {
  onComplete?: (destination?: "essentials") => void;
  initialMode?: "create" | "join";
  additionalHousehold?: boolean;
} = {}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const {
    createHousehold,
    joinHousehold,
    setHomeProfile,
    addChores,
    householdId,
    householdSetupStep,
    setHouseholdSetupStep,
    completeHouseholdSetup,
  } = useAppContext();
  const { session } = useSupabaseSession();
  const setupDraftKey = session?.user.id
    ? additionalHousehold
      ? `sweetmate:household-setup-draft:additional-v1:${session.user.id}`
      : `sweetmate:household-setup-draft:v2:${session.user.id}`
    : null;
  const [mode, setMode] = useState<"create" | "join">(initialMode);
  const [step, setStep] = useState(() =>
    !additionalHousehold && householdSetupStep
      ? householdSetupStepNumber(householdSetupStep)
      : 1,
  );
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createInviteCode] = useState(makeInviteCode);
  const [color, setColor] = useState(COLORS[0]);
  const [housingType, setHousingType] = useState<HousingType | null>(null);
  const [bathroomCount, setBathroomCount] = useState(1);
  const [bedroomCount, setBedroomCount] = useState(1);
  const [items, setItems] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<Record<string, string[]>>({});
  const [customItemDrafts, setCustomItemDrafts] = useState<Record<string, string>>({});
  const [chores, setChores] = useState<string[]>([]);
  const [customChore, setCustomChore] = useState("");
  const [customCategory, setCustomCategory] = useState<ChoreCategory>("other");
  const [customRecurrence, setCustomRecurrence] = useState<PersistedRecurrence>("weekly");
  const [customPoints, setCustomPoints] = useState(15);
  const [customChoreSettings, setCustomChoreSettings] = useState<Record<string, {
    category: ChoreCategory;
    recurrence: PersistedRecurrence;
    points: number;
  }>>({});
  const [removedGeneratedKeys, setRemovedGeneratedKeys] = useState<Set<string>>(new Set());
  const [recurrenceOverrides, setRecurrenceOverrides] = useState<Record<string, PersistedRecurrence>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedDraftRef = useRef(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const navigationPendingRef = useRef(false);

  const generatedPlan = useMemo(
    () =>
      buildFeatureChorePlan(
        items.flatMap((value) => {
          const [category, ...itemParts] = value.split(":");
          const count = category === "bathroom" ? bathroomCount : category === "bedroom" ? bedroomCount : 1;
          return Array.from({ length: count }, (_, index) => ({
            roomInstanceId: `${category}-${index + 1}`,
            featureId: normalizeFeatureId(category, itemParts.join(":")),
          }));
        }),
      )
        .filter((chore) => !removedGeneratedKeys.has(chore.sourceKey))
        .map((chore) => ({
          ...chore,
          persistedRecurrence: recurrenceOverrides[chore.sourceKey] ?? chore.persistedRecurrence,
        })),
    [bathroomCount, bedroomCount, items, recurrenceOverrides, removedGeneratedKeys],
  );

  useEffect(() => {
    if (!setupDraftKey || hydratedDraftRef.current) return;
    hydratedDraftRef.current = true;
    AsyncStorage.getItem(setupDraftKey)
      .then((raw) => {
        if (!raw) return;
        const draft = JSON.parse(raw) as Partial<{
          householdName: string;
          displayName: string;
          color: string;
          housingType: HousingType;
          bathroomCount: number;
          bedroomCount: number;
          items: string[];
          customItems: Record<string, string[]>;
          chores: string[];
          customChoreSettings: typeof customChoreSettings;
          recurrenceOverrides: Record<string, PersistedRecurrence>;
          removedGeneratedKeys: string[];
        }>;
        if (draft.householdName) setHouseholdName(draft.householdName);
        if (draft.displayName) setDisplayName(draft.displayName);
        if (draft.color) setColor(draft.color);
        if (draft.housingType) setHousingType(draft.housingType);
        if (draft.bathroomCount) setBathroomCount(draft.bathroomCount);
        if (draft.bedroomCount) setBedroomCount(draft.bedroomCount);
        if (draft.items) setItems(draft.items);
        if (draft.customItems) setCustomItems(draft.customItems);
        if (draft.chores) setChores(draft.chores);
        if (draft.customChoreSettings) setCustomChoreSettings(draft.customChoreSettings);
        if (draft.recurrenceOverrides) setRecurrenceOverrides(draft.recurrenceOverrides);
        if (draft.removedGeneratedKeys) {
          setRemovedGeneratedKeys(new Set(draft.removedGeneratedKeys));
        }
      })
      .catch((draftError) => reportRuntimeError("restore household setup draft", draftError))
      .finally(() => setDraftHydrated(true));
  }, [setupDraftKey]);

  useEffect(() => {
    if (!setupDraftKey || !draftHydrated || mode !== "create") return;
    const draft = {
      householdName,
      displayName,
      color,
      housingType,
      bathroomCount,
      bedroomCount,
      items,
      customItems,
      chores,
      customChoreSettings,
      recurrenceOverrides,
      removedGeneratedKeys: [...removedGeneratedKeys],
    };
    void AsyncStorage.setItem(setupDraftKey, JSON.stringify(draft)).catch((draftError) =>
      reportRuntimeError("save household setup draft", draftError),
    );
  }, [
    bathroomCount,
    bedroomCount,
    chores,
    color,
    customChoreSettings,
    customItems,
    displayName,
    draftHydrated,
    householdName,
    housingType,
    items,
    mode,
    recurrenceOverrides,
    removedGeneratedKeys,
    setupDraftKey,
  ]);

  useEffect(() => {
    if (additionalHousehold || !householdSetupStep) return;
    const restoredStep = householdSetupStepNumber(householdSetupStep);
    setStep((current) => (current === restoredStep ? current : restoredStep));
  }, [additionalHousehold, householdSetupStep]);

  const changeMode = (next: "create" | "join") => {
    setMode(next);
    setStep(1);
    setError(null);
  };
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) =>
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  const goToStep = async (nextStep: HouseholdSetupStep) => {
    if (navigationPendingRef.current) return;
    navigationPendingRef.current = true;
    setStep(householdSetupStepNumber(nextStep));
    try {
      if (!additionalHousehold) await setHouseholdSetupStep(nextStep);
    } finally {
      navigationPendingRef.current = false;
    }
  };

  const next = async () => {
    setError(null);
    if (step === 1 && !displayName.trim()) return setError("Enter the name your roommates will see.");
    if (step === 1 && !householdName.trim()) return setError("Give your household a name.");
    if (step === 2 && !housingType) return setError("Choose the type of home you live in.");
    if (step === 1) {
      if (loading) return;
      setLoading(true);
      try {
        if (!additionalHousehold) await setHouseholdSetupStep("home");
        if (!householdId || additionalHousehold) {
          await createHousehold(
            householdName,
            displayName,
            color,
            createInviteCode,
            { deferOnboarding: true },
          );
        }
        setStep(2);
      } catch (createError) {
        if (!additionalHousehold) await setHouseholdSetupStep(null);
        reportRuntimeError("create draft household", createError);
        setError("We couldn't start your household setup.");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (step === 2) await goToStep("essentials");
    else if (step === 4) await goToStep("review");
  };

  const submitJoin = async () => {
    setError(null);
    if (!displayName.trim()) return setError("Enter the name your roommates will see.");
    if (inviteCode.trim().length < 6) return setError("Enter the invite code from your roommate.");
    setLoading(true);
    try {
      await joinHousehold(inviteCode, displayName, color);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete?.();
    } catch (e) {
      reportRuntimeError("join household", e);
      hapticError();
      setError(e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "We couldn't connect you to that household.");
    } finally { setLoading(false); }
  };

  const submitCreate = async () => {
    if (loading) return;
    if (!housingType || !householdId) return;
    setLoading(true);
    setError(null);
    try {
      setHomeProfile({ housingType, items, additionalChores: chores, roomCounts: { bathroom: bathroomCount, bedroom: bedroomCount } });
      const assigneeId = session?.user.id;
      if (!assigneeId) throw new Error("Your session expired before chores could be created.");
      const now = Date.now();
      addChores([
        ...generatedPlan.map((chore) => ({
          title: chore.title,
          householdId,
          assignedTo: assigneeId,
          dueDate: new Date(now + (chore.persistedRecurrence === "daily" ? 1 : chore.persistedRecurrence === "weekly" ? 7 : 30) * 86_400_000).toISOString(),
          completed: false,
          points: chore.points,
          category: chore.category,
          recurring: chore.persistedRecurrence,
          sourceKey: chore.sourceKey,
        })),
        ...chores.map((title) => {
          const settings = customChoreSettings[title] ?? {
            category: "other" as ChoreCategory,
            recurrence: "weekly" as PersistedRecurrence,
            points: 15,
          };
          return {
            title,
            householdId,
            assignedTo: assigneeId,
            dueDate: new Date(now + (settings.recurrence === "daily" ? 1 : settings.recurrence === "weekly" ? 7 : 30) * 86_400_000).toISOString(),
            completed: false,
            points: settings.points,
            category: settings.category,
            recurring: settings.recurrence,
          };
        }),
      ]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!additionalHousehold) await completeHouseholdSetup();
      if (setupDraftKey) await AsyncStorage.removeItem(setupDraftKey);
      onComplete?.();
    } catch (e) {
      reportRuntimeError("create household", e);
      hapticError();
      setError(e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "We couldn't create your household.");
    } finally { setLoading(false); }
  };

  const addCustomChore = () => {
    const value = customChore.trim();
    if (!value || chores.includes(value)) return;
    setChores([...chores, value]);
    setCustomChoreSettings((current) => ({
      ...current,
      [value]: { category: customCategory, recurrence: customRecurrence, points: customPoints },
    }));
    setCustomChore("");
  };

  const itemKey = (section: string, item: string) => `${section}:${item}`;
  const addCustomItem = (section: string) => {
    const value = (customItemDrafts[section] ?? "").trim();
    if (!value || (customItems[section] ?? []).includes(value)) return;
    setCustomItems((current) => ({ ...current, [section]: [...(current[section] ?? []), value] }));
    setCustomItemDrafts((current) => ({ ...current, [section]: "" }));
    setItems((current) => [...current, itemKey(section, value)]);
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        {mode === "create" && <Progress step={step} colors={colors} />}
        <View style={styles.brand}><BrandMark size={58} color={colors.primary} /></View>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>{mode === "create" ? `CREATE YOUR SWEET · STEP ${step} OF 5` : "JOIN YOUR SWEET"}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {mode === "join" ? "Join your roommates" : step === 1 ? "Start your household" : step === 2 ? "What kind of home is it?" : step === 3 ? "Buying for your Sweet?" : step === 4 ? "What's in your space?" : "Your chore plan"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {mode === "join" ? "Enter the invite code a roommate shared with you." : step === 1 ? "Set up your private household and invite your roommates." : step === 2 ? "This determines which fixed chore rules and Sweet Essentials suggestions apply." : step === 3 ? "Review a short list suggested for your home, or skip it for later." : step === 4 ? "Select everything your household shares. Your plan updates automatically." : "We created these chores from what is in your Sweet. Remove any you do not want or add your own."}
        </Text>

        {step === 1 && !householdId && !additionalHousehold && (
          <View style={[styles.segment, { backgroundColor: colors.muted }]}>
            {(["create", "join"] as const).map((item) => (
              <Pressable key={item} onPress={() => changeMode(item)} style={[styles.segmentButton, mode === item && { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name={item === "create" ? "home" : "user-plus"} size={16} color={mode === item ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.segmentText, { color: mode === item ? colors.foreground : colors.mutedForeground }]}>{item === "create" ? "Create a Sweet" : "Join a Sweet"}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {mode === "join" ? (
            <>
              <Field label="YOUR DISPLAY NAME" icon="user" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Liana" colors={colors} />
              <Field label="INVITE CODE" icon="key" value={inviteCode} onChangeText={(v: string) => setInviteCode(v.toUpperCase())} placeholder="8-character code" autoCapitalize="characters" colors={colors} />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>PROFILE COLOR</Text>
              <ColorPicker value={color} onChange={setColor} colors={colors} />
            </>
          ) : step === 1 ? (
            <>
              <Field label="YOUR DISPLAY NAME" icon="user" value={displayName} onChangeText={setDisplayName} editable={!householdId} placeholder="e.g. Liana" colors={colors} />
              <Field label="HOUSEHOLD NAME" icon="home" value={householdName} onChangeText={setHouseholdName} editable={!householdId} placeholder="e.g. The Maple House" colors={colors} />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>PROFILE COLOR</Text>
              <ColorPicker value={color} onChange={setColor} colors={colors} />
            </>
          ) : step === 2 ? (
            <View style={styles.optionList}>{HOUSING.map((option) => <SelectionCard key={option.key} title={option.label} subtitle={option.description} icon={option.icon} selected={housingType === option.key} onPress={() => setHousingType(option.key)} colors={colors} />)}</View>
          ) : step === 3 ? (
            <View style={styles.essentialsDecision}>
              <View style={[styles.decisionIllustration, { backgroundColor: colors.primary + "12" }]}>
                <Feather name="shopping-bag" size={30} color={colors.primary} />
              </View>
              <Text style={[styles.decisionTitle, { color: colors.foreground }]}>
                Need a hand setting up?
              </Text>
              <Text style={[styles.decisionBody, { color: colors.mutedForeground }]}>
                Browse a practical checklist and save only what your Sweet needs. Nothing is added unless you choose it.
              </Text>
              <Pressable
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Browse Sweet Essentials"
                onPress={() => {
                  if (navigationPendingRef.current) return;
                  navigationPendingRef.current = true;
                  router.push(`/planning?type=home-checklist&setup=household&housingType=${housingType}` as never);
                }}
                style={[styles.decisionButton, { backgroundColor: colors.primary, opacity: loading ? 0.65 : 1 }]}
              >
                <Feather name="shopping-bag" size={18} color="#fff" />
                <Text style={styles.decisionPrimaryText}>Browse Sweet Essentials</Text>
              </Pressable>
              <Pressable
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Skip Sweet Essentials for now"
                onPress={() => void goToStep("items")}
                style={[styles.decisionButton, { borderColor: colors.border, borderWidth: 1, opacity: loading ? 0.65 : 1 }]}
              >
                <Feather name="arrow-right" size={18} color={colors.foreground} />
                <Text style={[styles.decisionSecondaryText, { color: colors.foreground }]}>
                  Skip for now
                </Text>
              </Pressable>
            </View>
          ) : step === 4 ? (
            <View style={styles.itemSections}>
              {ITEM_SECTIONS.map((section) => (
                <View key={section.key} style={[styles.itemSection, { borderColor: colors.border }]}>
                  <View style={styles.itemSectionHeader}>
                    <View style={[styles.itemSectionIcon, { backgroundColor: colors.primary + "14" }]}>
                      <Feather name={section.icon} size={17} color={colors.primary} />
                    </View>
                    <Text style={[styles.itemSectionTitle, { color: colors.foreground }]}>{section.title}</Text>
                  </View>
                  {section.key === "bathroom" ? (
                    <View style={styles.chips}>
                      {[1, 2, 3].map((count) => (
                        <Chip
                          key={count}
                          label={`${count} ${count === 1 ? "bathroom" : "bathrooms"}`}
                          selected={bathroomCount === count}
                          onPress={() => setBathroomCount(count)}
                          colors={colors}
                        />
                      ))}
                    </View>
                  ) : null}
                  {section.key === "bedroom" ? (
                    <View style={styles.chips}>
                      {[1, 2, 3].map((count) => (
                        <Chip
                          key={count}
                          label={`${count} ${count === 1 ? "bedroom" : "bedrooms"}`}
                          selected={bedroomCount === count}
                          onPress={() => setBedroomCount(count)}
                          colors={colors}
                        />
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.chips}>
                    {[...section.items, ...(customItems[section.key] ?? [])].map((item) => {
                      const key = itemKey(section.key, item);
                      return <Chip key={key} label={item} selected={items.includes(key)} onPress={() => toggle(key, items, setItems)} colors={colors} />;
                    })}
                  </View>
                  <View style={[styles.customRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    <TextInput
                      value={customItemDrafts[section.key] ?? ""}
                      onChangeText={(value) => setCustomItemDrafts((current) => ({ ...current, [section.key]: value }))}
                      onSubmitEditing={() => addCustomItem(section.key)}
                      placeholder={`Add an item to ${section.title}`}
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.input, { color: colors.foreground }]}
                    />
                    <Pressable onPress={() => addCustomItem(section.key)} style={[styles.addButton, { backgroundColor: colors.primary }]}>
                      <Feather name="plus" color="#fff" size={18} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <>
              <View style={styles.reviewList}>
                {generatedPlan.length ? generatedPlan.map((chore) => (
                  <View key={chore.sourceKey} style={[styles.reviewRow, { borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.customChoreText, { color: colors.foreground }]}>{chore.title}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Change recurrence for ${chore.title}`}
                        onPress={() => {
                          const recurrences: PersistedRecurrence[] = ["daily", "weekly", "monthly"];
                          const next = recurrences[(recurrences.indexOf(chore.persistedRecurrence) + 1) % recurrences.length];
                          setRecurrenceOverrides((current) => ({ ...current, [chore.sourceKey]: next }));
                        }}
                      >
                        <Text style={[styles.reviewMeta, { color: colors.primary }]}>
                          {chore.persistedRecurrence} · {chore.points} points · {chore.category} · tap to change
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityLabel={`Remove ${chore.title}`}
                      onPress={() => setRemovedGeneratedKeys((current) => new Set([...current, chore.sourceKey]))}
                    >
                      <Feather name="x" size={18} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                )) : <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>Select household features to create mapped chores.</Text>}
              </View>
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 4 }]}>ADD A CUSTOM CHORE</Text>
              <View style={styles.chips}>
                {(["kitchen", "bathroom", "cleaning", "laundry", "other"] as ChoreCategory[]).map((category) => (
                  <Chip key={category} label={category} selected={customCategory === category} onPress={() => setCustomCategory(category)} colors={colors} />
                ))}
              </View>
              <View style={styles.chips}>
                {(["daily", "weekly", "monthly"] as PersistedRecurrence[]).map((recurrence) => (
                  <Chip key={recurrence} label={recurrence} selected={customRecurrence === recurrence} onPress={() => setCustomRecurrence(recurrence)} colors={colors} />
                ))}
                {[10, 15, 25, 30].map((points) => (
                  <Chip key={points} label={`${points} pts`} selected={customPoints === points} onPress={() => setCustomPoints(points)} colors={colors} />
                ))}
              </View>
              <View style={[styles.customRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <TextInput value={customChore} onChangeText={setCustomChore} onSubmitEditing={addCustomChore} placeholder="e.g. Water the plants" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} />
                <Pressable onPress={addCustomChore} style={[styles.addButton, { backgroundColor: colors.primary }]}><Feather name="plus" color="#fff" size={18} /></Pressable>
              </View>
              {chores.map((chore) => (
                <Pressable key={chore} onPress={() => setChores(chores.filter((item) => item !== chore))} style={styles.customChore}>
                  <Feather name="check-circle" size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.customChoreText, { color: colors.foreground }]}>{chore}</Text>
                    <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
                      {customChoreSettings[chore]?.recurrence ?? "weekly"} · {customChoreSettings[chore]?.points ?? 15} points · {customChoreSettings[chore]?.category ?? "other"}
                    </Text>
                  </View>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </>
          )}

          {error && <View style={[styles.error, { backgroundColor: colors.destructive + "12" }]}><Feather name="alert-circle" size={15} color={colors.destructive} /><Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text></View>}
          <View style={styles.actions}>
            {mode === "create" && step > 1 && <Pressable onPress={() => {
              const previous = step === 2 ? "details" : step === 3 ? "home" : step === 4 ? "essentials" : "items";
              void goToStep(previous);
              setError(null);
            }} style={[styles.back, { borderColor: colors.border }]}><Feather name="arrow-left" size={18} color={colors.foreground} /><Text style={[styles.backText, { color: colors.foreground }]}>Back</Text></Pressable>}
            {(step !== 3 || mode === "join") ? (
              <Pressable disabled={loading} onPress={mode === "join" ? submitJoin : step === 5 ? submitCreate : next} style={[styles.primary, { backgroundColor: colors.primary, opacity: loading ? .65 : 1 }]}>
                {loading ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryText}>{mode === "join" ? "Join household" : "Continue"}</Text><Feather name="arrow-right" size={17} color="#fff" /></>}
              </Pressable>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={async () => {
            try {
              const { error: signOutError } = await supabase.auth.signOut();
              if (signOutError) {
                reportSupabaseError("sign out from household setup", signOutError);
                setError(signOutError.message);
              }
            } catch (signOutError) {
              reportRuntimeError("sign out from household setup", signOutError);
              setError("We couldn't sign you out. Please try again.");
            }
          }}
          style={styles.signOut}
        ><Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Signed in with the wrong account? Sign out</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Progress({ step, colors }: any) {
  return <View style={styles.progressWrap}><View style={styles.progressLabels}><Text style={[styles.progressText, { color: colors.foreground }]}>Household setup</Text><Text style={[styles.progressCount, { color: colors.mutedForeground }]}>{step}/5</Text></View><View style={[styles.progressTrack, { backgroundColor: colors.muted }]}><View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${step * 20}%` }]} /></View><View style={styles.progressDots}>{["Details", "Home", "Essentials", "Items", "Review"].map((label, index) => <Text key={label} style={[styles.progressDotLabel, { color: index + 1 <= step ? colors.primary : colors.mutedForeground }]}>{label}</Text>)}</View></View>;
}
function Field({ label, icon, colors, ...props }: any) { return <View><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}><Feather name={icon} size={16} color={colors.mutedForeground} /><TextInput {...props} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} /></View></View>; }
function ColorPicker({ value, onChange, colors }: any) { return <View style={styles.swatches}>{COLORS.map((item) => <Pressable key={item} onPress={() => onChange(item)} style={[styles.swatch, { backgroundColor: item }, value === item && { borderColor: colors.foreground, borderWidth: 3 }]}>{value === item && <Feather name="check" size={16} color="#fff" />}</Pressable>)}</View>; }
function SelectionCard({ title, subtitle, icon, selected, onPress, colors }: any) { return <Pressable onPress={onPress} style={[styles.selectionCard, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "10" : colors.card }]}><View style={[styles.selectionIcon, { backgroundColor: selected ? colors.primary : colors.muted }]}><Feather name={icon} size={20} color={selected ? "#fff" : colors.mutedForeground} /></View><View style={{ flex: 1 }}><Text style={[styles.selectionTitle, { color: selected ? colors.primary : colors.foreground }]}>{title}</Text><Text style={[styles.selectionSub, { color: colors.mutedForeground }]}>{subtitle}</Text></View><Feather name={selected ? "check-circle" : "circle"} size={21} color={selected ? colors.primary : colors.border} /></Pressable>; }
function Chip({ label, selected, onPress, colors }: any) { return <Pressable onPress={onPress} style={[styles.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "12" : colors.muted }]}><Feather name={selected ? "check" : "plus"} size={14} color={selected ? colors.primary : colors.mutedForeground} /><Text style={[styles.chipText, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { paddingHorizontal: 22 }, brand: { alignItems: "center", marginBottom: 12 }, eyebrow: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 1.5, textAlign: "center" }, title: { fontFamily: "Inter_700Bold", fontSize: 32, lineHeight: 36, textAlign: "center", marginTop: 5 }, subtitle: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 20 },
  progressWrap: { marginBottom: 16 }, progressLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }, progressText: { fontFamily: "Inter_700Bold", fontSize: 14 }, progressCount: { fontFamily: "Inter_600SemiBold", fontSize: 13 }, progressTrack: { height: 7, borderRadius: 4, overflow: "hidden" }, progressFill: { height: "100%", borderRadius: 4 }, progressDots: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 }, progressDotLabel: { width: "20%", textAlign: "center", fontFamily: "Inter_600SemiBold", fontSize: 10 },
  segment: { borderRadius: 16, padding: 4, flexDirection: "row", marginBottom: 14 }, segmentButton: { flex: 1, height: 48, borderRadius: 13, borderWidth: 1, borderColor: "transparent", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, segmentText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 16 }, label: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 1, marginBottom: 7 }, inputWrap: { height: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 }, input: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 16 },
  swatches: { flexDirection: "row", justifyContent: "space-between" }, swatch: { width: 39, height: 39, borderRadius: 20, alignItems: "center", justifyContent: "center", borderColor: "transparent" }, optionList: { gap: 10 }, selectionCard: { borderWidth: 1.5, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, selectionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" }, selectionTitle: { fontFamily: "Inter_700Bold", fontSize: 18 }, selectionSub: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 18, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, chip: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 6 }, chipText: { fontFamily: "Inter_600SemiBold", fontSize: 14 }, customRow: { height: 52, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, flexDirection: "row", alignItems: "center" }, addButton: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" }, customChore: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 }, customChoreText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 15 },
  itemSections: { gap: 14 }, itemSection: { borderBottomWidth: 1, paddingBottom: 14, gap: 12 }, itemSectionHeader: { flexDirection: "row", alignItems: "center", gap: 9 }, itemSectionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" }, itemSectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  reviewList: { gap: 8 },
  reviewRow: { minHeight: 58, borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  reviewMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 3 },
  essentialsDecision: { alignItems: "center", gap: 12, paddingVertical: 8 },
  decisionIllustration: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  decisionTitle: { fontFamily: "Inter_700Bold", fontSize: 21, textAlign: "center" },
  decisionBody: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 4 },
  decisionButton: { width: "100%", minHeight: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9, paddingHorizontal: 14 },
  decisionPrimaryText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  decisionSecondaryText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  error: { padding: 12, borderRadius: 12, flexDirection: "row", gap: 8 }, errorText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14 }, actions: { flexDirection: "row", gap: 10 }, back: { height: 54, borderRadius: 15, borderWidth: 1, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, backText: { fontFamily: "Inter_700Bold", fontSize: 16 }, primary: { flex: 1, height: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 }, primaryText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 }, signOut: { padding: 18, alignItems: "center" }, signOutText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
