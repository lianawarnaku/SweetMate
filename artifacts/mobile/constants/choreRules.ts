import type { HousingType } from "../context/AppContext";
import type { ItemCategory } from "./itemDifficulty";
import {
  buildFeatureChorePlan,
  FEATURE_CHORE_RULES,
  normalizeFeatureId,
} from "./featureChoreRegistry.ts";

export type ChoreFrequency = "daily" | "everyOtherDay" | "everyThreeDays" | "weekly" | "biweekly" | "monthly";
export type ChoreTimeOfDay = "morning" | "night" | "any";

export interface ChoreRuleTask {
  id: string;
  title: string;
  frequency: ChoreFrequency;
  timeOfDay: ChoreTimeOfDay;
  keepTogetherGroup?: string;
}

export interface ItemChoreRule {
  category: ItemCategory;
  item: string;
  tasks: ChoreRuleTask[];
}

export const choreRuleKey = (category: ItemCategory, item: string) =>
  normalizeFeatureId(category, item);

export function occurrencesPerWeek(frequency: ChoreFrequency): number {
  return {
    daily: 7,
    everyOtherDay: 3.5,
    everyThreeDays: 7 / 3,
    weekly: 1,
    biweekly: 0.5,
    monthly: 12 / 52,
  }[frequency];
}

function ruleForFeature(featureId: string, housingType?: HousingType): ItemChoreRule | undefined {
  if (!FEATURE_CHORE_RULES[featureId]) return undefined;
  const separator = featureId.indexOf(":");
  const category = featureId.slice(0, separator) as ItemCategory;
  const item = featureId.slice(separator + 1).replace(/_/g, " ");
  return {
    category,
    item,
    tasks: buildFeatureChorePlan([{ roomInstanceId: `${category}-1`, featureId }], housingType)
      .map((task) => ({
        id: task.id,
        title: task.title,
        frequency: task.persistedRecurrence,
        timeOfDay: task.timeOfDay ?? "any",
        keepTogetherGroup: task.keepTogetherGroup,
      })),
  };
}

// Compatibility lookups use the same complete catalogue as onboarding and planning.
export const CHORE_RULES: Readonly<Record<string, ItemChoreRule>> = Object.fromEntries(
  Object.keys(FEATURE_CHORE_RULES).map((featureId) => [featureId, ruleForFeature(featureId)!]),
);

export function getChoreRule(
  category: ItemCategory,
  item: string,
  housingType?: HousingType,
): ItemChoreRule | undefined {
  return ruleForFeature(choreRuleKey(category, item), housingType);
}
