import type {
  ChoreCategory,
  CustomTask,
  GeneratedTask,
  HousingType,
} from "../context/AppContext";
import type {
  ItemCategory,
  ItemDifficultyDefault,
} from "../constants/itemDifficulty";
import {
  FEATURE_CHORE_RULES,
  normalizeFeatureId,
} from "../constants/featureChoreRegistry.ts";
import { difficultyForPoints } from "./choreChart.ts";
import {
  buildHouseholdTasks,
  parseHouseholdAmenities,
} from "./taskGenerator.ts";

export interface SetupCustomChoreSettings {
  category: ChoreCategory;
  recurrence: GeneratedTask["frequency"];
  points: number;
}

export function setupCustomTaskId(householdId: string, title: string): string {
  return `setup-custom:${householdId}:${encodeURIComponent(title.trim().replace(/\s+/g, " ").toLowerCase())}`;
}

/** One task snapshot for the setup review, initial chart and later planner rebuilds. */
export function buildHouseholdSetupChores({
  householdId,
  housingType,
  items,
  roomCounts = {},
  itemDifficulties = [],
  customChores = [],
  customChoreSettings = {},
  removedGeneratedKeys = [],
  recurrenceOverrides = {},
}: {
  householdId: string;
  housingType: HousingType;
  items: string[];
  roomCounts?: Partial<Record<ItemCategory, number>>;
  itemDifficulties?: readonly ItemDifficultyDefault[];
  customChores?: string[];
  customChoreSettings?: Record<string, SetupCustomChoreSettings>;
  removedGeneratedKeys?: readonly string[];
  recurrenceOverrides?: Record<string, GeneratedTask["frequency"]>;
}): {
  generatedTasks: GeneratedTask[];
  customTasks: CustomTask[];
  tasks: GeneratedTask[];
  unsupportedItems: string[];
} {
  const selectedAmenities = parseHouseholdAmenities(items);
  const unsupportedItems = selectedAmenities
    .filter(
      (amenity) =>
        !FEATURE_CHORE_RULES[
          normalizeFeatureId(amenity.category, amenity.item)
        ],
    )
    .map((amenity) => amenity.item);
  const amenities = selectedAmenities.flatMap((amenity) => {
    const configuredCount = roomCounts[amenity.category];
    const count =
      configuredCount && Number.isFinite(configuredCount)
        ? Math.max(1, Math.floor(configuredCount))
        : 1;
    return Array.from({ length: count }, (_, index) => ({
      ...amenity,
      roomInstanceId: `${amenity.category}-${index + 1}`,
    }));
  });
  const removed = new Set(removedGeneratedKeys);
  const generatedTasks = buildHouseholdTasks(
    amenities,
    housingType,
    [],
    itemDifficulties,
  )
    .filter((task) => !removed.has(task.id))
    .map((task) => ({
      ...task,
      frequency: recurrenceOverrides[task.id] ?? task.frequency,
    }));
  const customById = new Map<string, CustomTask>();
  for (const title of customChores) {
    const cleanedTitle = title.trim();
    if (!cleanedTitle) continue;
    const settings = customChoreSettings[title] ?? {
      category: "other",
      recurrence: "weekly",
      points: 15,
    };
    const id = setupCustomTaskId(householdId, cleanedTitle);
    customById.set(id, {
      id,
      title: cleanedTitle,
      item: cleanedTitle,
      itemCategory:
        settings.category === "cleaning"
          ? "living"
          : settings.category === "outdoor"
            ? "other"
            : settings.category,
      frequency: settings.recurrence,
      timeOfDay: "any",
      difficulty: difficultyForPoints(settings.points),
    });
  }
  const customTasks = [...customById.values()];
  return {
    generatedTasks,
    customTasks,
    unsupportedItems,
    tasks: [
      ...generatedTasks,
      ...buildHouseholdTasks([], housingType, customTasks, itemDifficulties),
    ],
  };
}
