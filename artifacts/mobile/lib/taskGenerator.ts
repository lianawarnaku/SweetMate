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
