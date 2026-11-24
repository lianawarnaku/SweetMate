import {
  buildFeatureChorePlan,
  normalizeFeatureId,
  RECURRENCE_COMPATIBILITY,
} from "../constants/featureChoreRegistry.ts";
import { isItemCategory, resolveItemDifficulty, type ItemCategory, type ItemDifficultyDefault } from "../constants/itemDifficulty.ts";
import type {
  CustomTask,
  GeneratedTask,
  HousingType,
  HomeProfile,
} from "@/context/AppContext";

export interface SelectedAmenity {
  category: ItemCategory;
  item: string;
  roomInstanceId?: string;
}

export function parseHouseholdAmenities(items: string[]): SelectedAmenity[] {
  return items.flatMap((value) => {
    const separator = value.indexOf(":");
    if (separator < 1) return [];
    const category = value.slice(0, separator);
    if (!isItemCategory(category)) return [];
    return [{ category, item: value.slice(separator + 1) }];
  });
}

export function buildHouseholdTasks(
  amenities: readonly SelectedAmenity[],
  housingType: HousingType,
  customTasks: readonly CustomTask[] = [],
  itemDifficulties: readonly ItemDifficultyDefault[] = [],
): GeneratedTask[] {
  const amenityKey = (amenity: SelectedAmenity) =>
    `${amenity.roomInstanceId ?? `${amenity.category}-1`}:${normalizeFeatureId(amenity.category, amenity.item)}`;
  const amenityByRoomFeature = new Map(amenities.map((amenity) => [amenityKey(amenity), amenity]));
  const generated: GeneratedTask[] = buildFeatureChorePlan(
    amenities.map((amenity) => ({
      roomInstanceId: amenity.roomInstanceId ?? `${amenity.category}-1`,
      featureId: normalizeFeatureId(amenity.category, amenity.item),
    })),
    housingType,
  ).map((task) => {
    const amenity = amenityByRoomFeature.get(`${task.roomInstanceId}:${task.featureId}`);
    const itemCategory = amenity?.category ?? "other";
    const item = amenity?.item ?? task.featureId;
    return {
      id: task.sourceKey,
      itemCategory,
      item,
      title: task.title,
      frequency: RECURRENCE_COMPATIBILITY[task.recurrence],
      timeOfDay: task.timeOfDay ?? "any",
      keepTogetherGroup: task.keepTogetherGroup,
      difficulty: resolveItemDifficulty(itemCategory, item, itemDifficulties),
    };
  });

  return [
    ...generated,
    ...customTasks.map((task): GeneratedTask => ({
      ...task,
      itemCategory: task.itemCategory ?? "other",
      item: task.item,
    })),
  ];
}

/** Compatibility wrapper for callers that already await household generation. */
export async function generateHouseholdTasks(
  _householdId: string,
  amenities: readonly SelectedAmenity[],
  housingType: HousingType,
  customTasks: readonly CustomTask[] = [],
  itemDifficulties: readonly ItemDifficultyDefault[] = [],
): Promise<GeneratedTask[]> {
  return buildHouseholdTasks(amenities, housingType, customTasks, itemDifficulties);
}

/** Apply per-chore edits without changing the stable generated task identity. */
export function applyGeneratedTaskSettings(
  tasks: readonly GeneratedTask[],
  profile: Pick<HomeProfile, "removedGeneratedKeys" | "recurrenceOverrides" | "generatedTaskOverrides">,
): GeneratedTask[] {
  const removed = new Set(profile.removedGeneratedKeys ?? []);
  return tasks.filter((task) => !removed.has(task.id)).map((task) => {
    const override = profile.generatedTaskOverrides?.[task.id];
    return {
      ...task,
      title: override?.title?.trim() || task.title,
      difficulty: override?.difficulty ?? task.difficulty,
      frequency: profile.recurrenceOverrides?.[task.id] ?? task.frequency,
    };
  });
}

/** Shared source for the generated-task editor and the chart preview. */
export function buildConfiguredHouseholdTasks(
  profile: HomeProfile,
  customTasks: readonly CustomTask[] = [],
  itemDifficulties: readonly ItemDifficultyDefault[] = [],
): GeneratedTask[] {
  const amenities = parseHouseholdAmenities(profile.items).flatMap((amenity) => {
    const count = Math.max(1, Math.floor(profile.roomCounts?.[amenity.category] ?? 1));
    return Array.from({ length: count }, (_, index) => ({
      ...amenity, roomInstanceId: `${amenity.category}-${index + 1}`,
    }));
  });
  return applyGeneratedTaskSettings(
    buildHouseholdTasks(amenities, profile.housingType, customTasks, itemDifficulties),
    profile,
  );
}
