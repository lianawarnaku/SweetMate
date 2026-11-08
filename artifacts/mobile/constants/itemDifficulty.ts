import { normalizeFeatureId } from './featureChoreRegistry.ts';

export const ITEM_CATEGORIES = ['kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'other'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];

export function isItemCategory(value: string): value is ItemCategory {
  return (ITEM_CATEGORIES as readonly string[]).includes(value);
}
export interface ItemDifficultyDefault {
  category: ItemCategory;
  item: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
}
export const DEFAULT_ITEM_DIFFICULTY: ItemDifficultyDefault[] = [
  // Kitchen
  { category: 'kitchen',  item: 'Mini Fridge',    difficulty: 4 },
  { category: 'kitchen',  item: 'Stove',          difficulty: 4 },
  { category: 'kitchen',  item: 'Trash Can',      difficulty: 1 },
  { category: 'kitchen',  item: 'Microwave',      difficulty: 1 },
  { category: 'kitchen',  item: 'Kettle',         difficulty: 3 },
  { category: 'kitchen',  item: 'Floor',          difficulty: 3 },
  { category: 'kitchen',  item: 'Coffee Machine', difficulty: 3 },
  { category: 'kitchen',  item: 'Dishwasher',     difficulty: 2 },
  // Bathroom
  { category: 'bathroom', item: 'Bathroom Sink',  difficulty: 2 },
  { category: 'bathroom', item: 'Mirror',         difficulty: 1 },
  { category: 'bathroom', item: 'Shower',         difficulty: 4 },
  { category: 'bathroom', item: 'Toilet',         difficulty: 5 },
  { category: 'bathroom', item: 'Bath Mat',       difficulty: 1 },
  { category: 'bathroom', item: 'Floor',          difficulty: 4 },
  { category: 'bathroom', item: 'Trash Can',      difficulty: 1 },
  // Living Space
  { category: 'living',   item: 'Trash Can',      difficulty: 1 },
  { category: 'living',   item: 'Vacuum',         difficulty: 3 },
  { category: 'living',   item: 'Laundry Basket', difficulty: 2 },
  { category: 'living',   item: 'Floor',          difficulty: 3 },
  { category: 'bedroom',  item: 'Carpet',         difficulty: 3 },
  { category: 'bedroom',  item: 'Bed Linens',     difficulty: 3 },
  { category: 'laundry',  item: 'Washing Machine', difficulty: 4 },
  { category: 'laundry',  item: 'Dryer',           difficulty: 1 },
  // Other
  { category: 'other',    item: 'Trash Can',      difficulty: 3 },
];
// Fallback for any 'other'/custom item not explicitly listed:
export const OTHER_DEFAULT_DIFFICULTY: 1 | 2 | 3 | 4 | 5 = 3;
// Optional display names for levels 1–5 (leave empty to just show "N/5"):
export const DIFFICULTY_LABELS: Partial<Record<1|2|3|4|5, string>> = { /* TODO optional */ };

/** Resolve the same household weights used by the difficulty screen, including aliases. */
export function resolveItemDifficulty(
  category: ItemCategory,
  item: string,
  overrides: readonly ItemDifficultyDefault[] = [],
): ItemDifficultyDefault["difficulty"] {
  const featureId = normalizeFeatureId(category, item);
  const validOverride = overrides.find((entry) =>
    normalizeFeatureId(entry.category, entry.item) === featureId &&
    Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 5,
  );
  return validOverride?.difficulty ?? DEFAULT_ITEM_DIFFICULTY.find((entry) =>
    normalizeFeatureId(entry.category, entry.item) === featureId,
  )?.difficulty ?? OTHER_DEFAULT_DIFFICULTY;
}
