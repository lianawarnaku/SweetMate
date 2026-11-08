import type { ChoreCategory, HousingType } from "../context/AppContext";
import type { ChoreTimeOfDay } from "./choreRules";

export type PersistedRecurrence = "daily" | "everyOtherDay" | "everyThreeDays" | "weekly" | "biweekly" | "monthly";
export type RuleRecurrence = "daily" | "every_3_days" | "weekly" | "biweekly" | "monthly";

export interface ChoreTemplate {
  id: string;
  title: string;
  category: ChoreCategory;
  recurrence: RuleRecurrence;
  points: number;
  timeOfDay?: ChoreTimeOfDay;
  keepTogetherGroup?: string;
  housingTitles?: Partial<Record<HousingType, string>>;
}

export interface GeneratedChorePlanItem extends ChoreTemplate {
  sourceKey: string;
  featureId: string;
  roomInstanceId: string;
  persistedRecurrence: PersistedRecurrence;
}

// Registry intervals keep their exact cadence in previews and saved chore series.
export const RECURRENCE_COMPATIBILITY: Record<RuleRecurrence, PersistedRecurrence> = {
  daily: "daily",
  every_3_days: "everyThreeDays",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
};

export const FEATURE_CHORE_RULES: Readonly<Record<string, readonly ChoreTemplate[]>> = {
  "kitchen:trash_can": [
    { id: "empty-kitchen-trash", title: "Empty kitchen trash", category: "kitchen", recurrence: "every_3_days", points: 10, timeOfDay: "night" },
    { id: "outside-bin", title: "Take trash to outside bin", category: "other", recurrence: "weekly", points: 10, timeOfDay: "night", housingTitles: { traditional: "Take trash to shared disposal area", suite: "Take trash to shared disposal area" } },
  ],
  "bathroom:trash_can": [{ id: "empty-bathroom-trash", title: "Empty bathroom trash", category: "bathroom", recurrence: "weekly", points: 10 }],
  "living:trash_can": [{ id: "empty-living-trash", title: "Empty living area trash", category: "cleaning", recurrence: "every_3_days", points: 10, timeOfDay: "night" }],
  "other:trash_can": [{ id: "empty-shared-trash", title: "Empty shared trash", category: "other", recurrence: "every_3_days", points: 10, timeOfDay: "night" }],
  "bathroom:toilet": [{ id: "clean-toilet", title: "Clean toilet", category: "bathroom", recurrence: "weekly", points: 15 }],
  "bathroom:shower": [
    { id: "clean-shower", title: "Clean shower", category: "bathroom", recurrence: "weekly", points: 15 },
    { id: "deep-clean-shower", title: "Deep clean shower", category: "bathroom", recurrence: "biweekly", points: 25 },
  ],
  "bathroom:bathtub": [{ id: "clean-bathtub", title: "Clean bathtub", category: "bathroom", recurrence: "weekly", points: 15 }],
  "bathroom:bathroom_sink": [{ id: "clean-bathroom-sink", title: "Clean bathroom sink", category: "bathroom", recurrence: "weekly", points: 10 }],
  "bathroom:mirror": [{ id: "clean-bathroom-mirror", title: "Clean bathroom mirror", category: "bathroom", recurrence: "weekly", points: 10 }],
  "bathroom:bath_mat": [{ id: "wash-bath-mat", title: "Wash bath mat", category: "laundry", recurrence: "weekly", points: 10 }],
  "kitchen:dishwasher": [
    { id: "load-unload-dishwasher", title: "Unload dishwasher", category: "kitchen", recurrence: "daily", points: 10, timeOfDay: "morning", keepTogetherGroup: "dishwasher-daily" },
    { id: "load-run-dishwasher", title: "Load and run dishwasher", category: "kitchen", recurrence: "daily", points: 10, timeOfDay: "night", keepTogetherGroup: "dishwasher-daily" },
    { id: "clean-dishwasher-filter", title: "Clean dishwasher filter", category: "kitchen", recurrence: "monthly", points: 25 },
  ],
  "kitchen:refrigerator": [
    { id: "check-expired-food", title: "Check refrigerator for expired food", category: "kitchen", recurrence: "weekly", points: 10 },
    { id: "clean-refrigerator-shelves", title: "Clean refrigerator shelves", category: "kitchen", recurrence: "monthly", points: 25 },
  ],
  "kitchen:microwave": [{ id: "clean-microwave", title: "Clean microwave", category: "kitchen", recurrence: "biweekly", points: 15 }],
  "kitchen:stove": [
    { id: "wipe-stovetop", title: "Wipe stovetop", category: "kitchen", recurrence: "daily", points: 10, timeOfDay: "night" },
    { id: "deep-clean-stovetop", title: "Deep clean stovetop", category: "kitchen", recurrence: "monthly", points: 30 },
  ],
  "kitchen:kettle": [{ id: "descale-kettle", title: "Descale kettle", category: "kitchen", recurrence: "monthly", points: 15 }],
  "kitchen:coffee_machine": [
    { id: "clean-coffee-machine", title: "Clean coffee machine", category: "kitchen", recurrence: "weekly", points: 15 },
    { id: "descale-coffee-machine", title: "Descale coffee machine", category: "kitchen", recurrence: "monthly", points: 25 },
  ],
  "kitchen:floor": [{ id: "sweep-kitchen-floor", title: "Sweep kitchen floor", category: "kitchen", recurrence: "weekly", points: 15 }],
  "bathroom:floor": [{ id: "mop-bathroom-floor", title: "Mop bathroom floor", category: "bathroom", recurrence: "weekly", points: 15 }],
  "living:floor": [{ id: "vacuum-living-room", title: "Vacuum living room", category: "cleaning", recurrence: "weekly", points: 15 }],
  "living:vacuum": [{ id: "vacuum-living-room", title: "Vacuum living room", category: "cleaning", recurrence: "weekly", points: 15 }],
  "other:floor": [{ id: "clean-shared-floor", title: "Clean shared floor", category: "cleaning", recurrence: "weekly", points: 15 }],
  "bedroom:carpet": [{ id: "vacuum-bedroom", title: "Vacuum bedroom", category: "cleaning", recurrence: "weekly", points: 15 }],
  "bedroom:bed_linens": [{ id: "change-bed-linens", title: "Change bed linens", category: "laundry", recurrence: "biweekly", points: 15 }],
  "laundry:laundry_basket": [{ id: "clean-laundry-basket", title: "Clean laundry basket", category: "laundry", recurrence: "monthly", points: 10 }],
  "laundry:washing_machine": [{ id: "clean-washing-machine", title: "Clean washing machine", category: "laundry", recurrence: "monthly", points: 25 }],
  "laundry:dryer": [
    { id: "empty-lint-trap", title: "Empty dryer lint trap", category: "laundry", recurrence: "daily", points: 5 },
    { id: "clean-dryer-lint-area", title: "Clean dryer lint area", category: "laundry", recurrence: "monthly", points: 25 },
  ],
};

export function normalizeFeatureId(category: string, displayName: string): string {
  const normalized = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases: Record<string, string> = {
    "kitchen:mini_fridge": "kitchen:refrigerator",
    "kitchen:fridge": "kitchen:refrigerator",
    "bathroom:sink": "bathroom:bathroom_sink",
    "living:laundry_basket": "laundry:laundry_basket",
    "living:washing_machine": "laundry:washing_machine",
    "living:dryer": "laundry:dryer",
    "kitchen:coffee_maker": "kitchen:coffee_machine",
    "kitchen:electric_kettle": "kitchen:kettle",
  };
  const key = `${category}:${normalized}`;
  return aliases[key] ?? key;
}

export function buildFeatureChorePlan(
  selections: readonly { roomInstanceId: string; featureId: string }[],
  housingType?: HousingType,
): GeneratedChorePlanItem[] {
  const bySourceKey = new Map<string, GeneratedChorePlanItem>();
  const featureCounts = new Map<string, number>();
  selections.forEach((selection) =>
    featureCounts.set(selection.featureId, (featureCounts.get(selection.featureId) ?? 0) + 1),
  );
  for (const selection of selections) {
    for (const template of FEATURE_CHORE_RULES[selection.featureId] ?? []) {
      const sourceKey = `setup:${selection.roomInstanceId}:${selection.featureId}:${template.id}`;
      const roomSuffix =
        (featureCounts.get(selection.featureId) ?? 0) > 1
          ? ` (${selection.roomInstanceId.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())})`
          : "";
      bySourceKey.set(sourceKey, {
        ...template,
        title: `${(housingType && template.housingTitles?.[housingType]) || template.title}${roomSuffix}`,
        keepTogetherGroup: template.keepTogetherGroup
          ? `${selection.roomInstanceId}:${selection.featureId}:${template.keepTogetherGroup}`
          : undefined,
        sourceKey,
        featureId: selection.featureId,
        roomInstanceId: selection.roomInstanceId,
        persistedRecurrence: RECURRENCE_COMPATIBILITY[template.recurrence],
      });
    }
  }
  return [...bySourceKey.values()];
}
