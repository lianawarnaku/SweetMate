import {
  essentialRecommendationsForHousingType,
  recommendationsUseCatalogIds,
} from "./essentialRecommendations.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(recommendationsUseCatalogIds(), "every recommendation must use a real catalog ID");

for (const housingType of ["traditional", "suite", "apartment", "other"] as const) {
  const first = essentialRecommendationsForHousingType(housingType);
  const second = essentialRecommendationsForHousingType(housingType);
  assert(first === second, `${housingType} recommendations must be deterministic`);
  assert(
    first.length > 0 && first.length <= 6,
    `${housingType} recommendations must remain limited and intentional`,
  );
  assert(
    new Set(first.map(({ categoryId, itemId }) => `${categoryId}:${itemId}`)).size ===
      first.length,
    `${housingType} recommendations must not contain duplicates`,
  );
}

assert(
  essentialRecommendationsForHousingType("unsupported").length === 0,
  "unknown housing types must not receive guessed defaults",
);

assert(essentialRecommendationsForHousingType("other") === essentialRecommendationsForHousingType("apartment"), "Other homes must reuse the apartment essentials defaults");
