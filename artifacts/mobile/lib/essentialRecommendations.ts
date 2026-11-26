import {
  ESSENTIAL_CATALOG,
  type EssentialCategoryDefinition,
} from "../constants/essentialCatalog.ts";

export type SupportedHousingType = "traditional" | "suite" | "apartment" | "other";

export type EssentialRecommendation = {
  categoryId: string;
  itemId: string;
};

const RECOMMENDATIONS_BY_HOUSING_TYPE: Record<
  Exclude<SupportedHousingType, "other">,
  readonly EssentialRecommendation[]
> = {
  traditional: [
    { categoryId: "cleaning", itemId: "cleaning-disinfectant" },
    { categoryId: "cleaning", itemId: "cleaning-detergent" },
    { categoryId: "cleaning", itemId: "cleaning-trash-bags" },
    { categoryId: "room", itemId: "room-shower-caddy" },
  ],
  suite: [
    { categoryId: "bathroom", itemId: "bathroom-toilet-cleaner" },
    { categoryId: "bathroom", itemId: "bathroom-toilet-paper" },
    { categoryId: "cleaning", itemId: "cleaning-all-purpose" },
    { categoryId: "cleaning", itemId: "cleaning-detergent" },
    { categoryId: "cleaning", itemId: "cleaning-trash-bags" },
  ],
  apartment: [
    { categoryId: "kitchen", itemId: "kitchen-dish-soap" },
    { categoryId: "kitchen", itemId: "kitchen-sponges" },
    { categoryId: "kitchen", itemId: "kitchen-trash-bags" },
    { categoryId: "bathroom", itemId: "bathroom-toilet-cleaner" },
    { categoryId: "cleaning", itemId: "cleaning-all-purpose" },
    { categoryId: "cleaning", itemId: "cleaning-detergent" },
  ],
};

export function essentialRecommendationsForHousingType(
  housingType: string | null | undefined,
): readonly EssentialRecommendation[] {
  if (housingType === "other") return RECOMMENDATIONS_BY_HOUSING_TYPE.apartment;
  if (
    housingType !== "traditional" &&
    housingType !== "suite" &&
    housingType !== "apartment"
  ) {
    return [];
  }
  return RECOMMENDATIONS_BY_HOUSING_TYPE[housingType];
}

export function recommendationsUseCatalogIds(
  catalog: readonly EssentialCategoryDefinition[] = ESSENTIAL_CATALOG,
) {
  const catalogIds = new Set(
    catalog.flatMap((category) =>
      category.items.map((entry) => `${category.id}:${entry.id}`),
    ),
  );
  return Object.values(RECOMMENDATIONS_BY_HOUSING_TYPE)
    .flat()
    .every(({ categoryId, itemId }) =>
      catalogIds.has(`${categoryId}:${itemId}`),
    );
}
