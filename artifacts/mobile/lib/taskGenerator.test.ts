import { strict as assert } from "node:assert";
import { getChoreRule, occurrencesPerWeek } from "../constants/choreRules.ts";
import {
  buildFeatureChorePlan,
  normalizeFeatureId,
} from "../constants/featureChoreRegistry.ts";
import { resolveItemDifficulty } from "../constants/itemDifficulty.ts";
import { buildBalancedChart, taskLoad } from "./choreEngine.ts";
import {
  buildHouseholdTasks,
  generateHouseholdTasks,
  parseHouseholdAmenities,
} from "./taskGenerator.ts";

const householdId = "household";
const members = [{ id: "a" }, { id: "b" }];
const amenities = parseHouseholdAmenities([
  "bathroom:Toilet",
  "bathroom:Bathroom sink",
  "bathroom:Mirror",
  "bedroom:Carpet",
  "bedroom:Bed linens",
  "laundry:Dryer",
]);
assert.equal(
  amenities.length,
  6,
  "bedroom/laundry selections must survive household profile parsing",
);
const baseline = await generateHouseholdTasks(
  householdId,
  amenities,
  "apartment",
);
assert.deepEqual(
  buildHouseholdTasks(amenities, "apartment"),
  baseline,
  "synchronous onboarding previews and the async planner wrapper must produce identical tasks",
);
const toilet = baseline.find((task) => task.title === "Clean toilet")!;
assert.equal(
  toilet.difficulty,
  5,
  "generated difficulty must match the displayed default for a toilet",
);
const weighted = await generateHouseholdTasks(
  householdId,
  amenities,
  "apartment",
  [],
  [{ category: "bathroom", item: "toilet", difficulty: 1 }],
);
assert.deepEqual(
  buildHouseholdTasks(
    amenities,
    "apartment",
    [],
    [{ category: "bathroom", item: "toilet", difficulty: 1 }],
  ),
  weighted,
  "the pure preview must apply the same household weights as the async wrapper",
);
const lighterToilet = weighted.find((task) => task.id === toilet.id)!;
assert.equal(
  lighterToilet.difficulty,
  1,
  "saved household item weights must change generated tasks",
);
assert.equal(taskLoad(lighterToilet), 1);
assert.equal(taskLoad(toilet), 5);
assert.notDeepEqual(
  buildBalancedChart(weighted, members).memberLoads,
  buildBalancedChart(baseline, members).memberLoads,
  "changing real generated weights must alter the balance calculation",
);
assert.equal(
  resolveItemDifficulty("kitchen", "Fridge", [
    { category: "kitchen", item: "Mini Fridge", difficulty: 2 },
  ]),
  2,
  "aliases and capitalization must resolve the same saved difficulty",
);

const dishwasher = await generateHouseholdTasks(
  householdId,
  [{ category: "kitchen", item: "Dishwasher" }],
  "suite",
);
const morningTask = dishwasher.find((task) => task.timeOfDay === "morning")!;
const nightTask = dishwasher.find((task) => task.timeOfDay === "night")!;
assert.ok(
  morningTask && nightTask,
  "real built-in tasks must carry meaningful preference attributes",
);
assert.equal(morningTask.keepTogetherGroup, nightTask.keepTogetherGroup);
const preferences = [
  { householdId, memberId: "a", key: "morning", value: 100 },
  { householdId, memberId: "a", key: "night", value: 0 },
  { householdId, memberId: "b", key: "morning", value: 0 },
  { householdId, memberId: "b", key: "night", value: 100 },
];
const preferred = buildBalancedChart(dishwasher, members, preferences, {
  mode: "preference",
});
assert.ok(
  preferred.assignments
    .find((entry) => entry.memberId === "a")
    ?.taskIds.includes(morningTask.id),
);
assert.ok(
  preferred.assignments
    .find((entry) => entry.memberId === "b")
    ?.taskIds.includes(nightTask.id),
);
const swapped = buildBalancedChart(
  dishwasher,
  members,
  preferences.map((entry) => ({ ...entry, value: 100 - entry.value })),
  { mode: "preference" },
);
assert.ok(
  swapped.assignments
    .find((entry) => entry.memberId === "b")
    ?.taskIds.includes(morningTask.id),
  "changing saved time preferences must change ownership of an actual generated task",
);

const recurring = await generateHouseholdTasks(
  householdId,
  [
    { category: "kitchen", item: "Trash can" },
    { category: "kitchen", item: "Microwave" },
    { category: "bedroom", item: "Bed linens" },
  ],
  "apartment",
);
const trash = recurring.find((task) => task.title === "Empty kitchen trash")!;
assert.equal(
  trash.frequency,
  "everyThreeDays",
  "three-day rules must not become two-day chores",
);
assert.equal(taskLoad(trash), 7 / 3);
assert.equal(
  recurring.find((task) => task.title === "Clean microwave")?.frequency,
  "biweekly",
);
assert.equal(
  recurring.find((task) => task.title === "Change bed linens")?.frequency,
  "biweekly",
);
assert.equal(occurrencesPerWeek("everyThreeDays"), 7 / 3);
const preview = buildFeatureChorePlan([
  { roomInstanceId: "kitchen-1", featureId: "kitchen:trash_can" },
  { roomInstanceId: "kitchen-1", featureId: "kitchen:microwave" },
]);
assert.equal(
  preview.find((task) => task.id === "empty-kitchen-trash")
    ?.persistedRecurrence,
  trash.frequency,
);
assert.equal(
  preview.find((task) => task.id === "clean-microwave")?.persistedRecurrence,
  "biweekly",
  "setup previews must persist the same cadence as planning",
);

const oneRoom = await generateHouseholdTasks(
  householdId,
  [{ category: "bathroom", item: "Toilet", roomInstanceId: "bathroom-1" }],
  "suite",
);
const twoRooms = await generateHouseholdTasks(
  householdId,
  [
    { category: "bathroom", item: "Toilet", roomInstanceId: "bathroom-1" },
    { category: "bathroom", item: "Toilet", roomInstanceId: "bathroom-2" },
  ],
  "suite",
);
assert.equal(
  twoRooms.length,
  oneRoom.length * 2,
  "each selected room needs its own work",
);
assert.equal(
  twoRooms[0].id,
  oneRoom[0].id,
  "adding a room must retain existing generated source keys",
);
assert.equal(new Set(twoRooms.map((task) => task.id)).size, twoRooms.length);
assert.match(twoRooms[1].title, /Bathroom 2/);
const multiRoomDishes = await generateHouseholdTasks(
  householdId,
  [
    { category: "kitchen", item: "Dishwasher", roomInstanceId: "kitchen-1" },
    { category: "kitchen", item: "Dishwasher", roomInstanceId: "kitchen-2" },
  ],
  "apartment",
);
assert.equal(
  new Set(
    multiRoomDishes
      .filter((task) => task.keepTogetherGroup)
      .map((task) => task.keepTogetherGroup),
  ).size,
  2,
  "unrelated rooms must not be forced into the same keep-together group",
);

const supported = await generateHouseholdTasks(
  householdId,
  parseHouseholdAmenities([
    "living:Laundry basket",
    "kitchen:Kettle",
    "kitchen:Coffee machine",
  ]),
  "traditional",
);
assert.ok(supported.some((task) => task.title === "Clean laundry basket"));
assert.ok(
  !supported.some((task) => task.title.includes("washing machine")),
  "owning a laundry basket must not invent a washing machine",
);
assert.ok(supported.some((task) => task.title === "Descale kettle"));
assert.ok(supported.some((task) => task.title === "Clean coffee machine"));
assert.equal(
  normalizeFeatureId("living", "Laundry Basket"),
  "laundry:laundry_basket",
);
assert.deepEqual(
  getChoreRule("kitchen", "Dishwasher", "suite")?.tasks.map((task) => task.id),
  dishwasher.map((task) => task.id.split(":").at(-1)),
  "legacy rule lookups must use the same catalogue without hiding explicitly selected appliances",
);
const traditionalTrash = await generateHouseholdTasks(
  householdId,
  [{ category: "kitchen", item: "Trash can" }],
  "traditional",
);
const disposal = traditionalTrash.find((task) =>
  task.title.includes("disposal area"),
)!;
assert.ok(
  disposal,
  "dorm and suite homes must use their supported shared disposal location",
);
assert.equal(
  disposal.id,
  recurring.find((task) => task.title === "Take trash to outside bin")?.id,
  "housing-specific wording must preserve the existing task identity",
);

const custom = {
  id: "custom",
  item: "Plants",
  title: "Water plants",
  frequency: "everyThreeDays" as const,
  timeOfDay: "morning" as const,
  difficulty: 2 as const,
};
const customResult = await generateHouseholdTasks(
  householdId,
  [],
  "apartment",
  [custom],
);
assert.deepEqual(
  customResult,
  [{ ...custom, itemCategory: "other" }],
  "explicit custom task settings must survive generation",
);
console.log("Task generator regression tests passed");
