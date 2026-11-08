import { strict as assert } from "node:assert";
import {
  buildHouseholdSetupChores,
  setupCustomTaskId,
} from "./householdSetupChores.ts";
import {
  buildHouseholdChart,
  materializeApprovedChart,
  pointsForDifficulty,
} from "./choreChart.ts";

const householdId = "household";
const selected = [
  "bathroom:Toilet",
  "bedroom:Bed linens",
  "kitchen:Trash can",
  "kitchen:Dishwasher",
  "other:Plants",
];
const base = buildHouseholdSetupChores({
  householdId,
  housingType: "apartment",
  items: selected,
  roomCounts: { bathroom: 2, bedroom: 3 },
});
assert.equal(
  base.generatedTasks.filter((task) => task.title.startsWith("Clean toilet"))
    .length,
  2,
);
assert.equal(
  base.generatedTasks.filter((task) =>
    task.title.startsWith("Change bed linens"),
  ).length,
  3,
  "setup must retain every selected bedroom in both the preview and saved chart",
);
assert.deepEqual(
  base.unsupportedItems,
  ["Plants"],
  "unmapped custom items must be shown as needing an explicit chore",
);
const removedId = base.generatedTasks.find(
  (task) => task.title === "Clean toilet (Bathroom 1)",
)!.id;
const trashId = base.generatedTasks.find(
  (task) => task.title === "Empty kitchen trash",
)!.id;
const plan = buildHouseholdSetupChores({
  householdId,
  housingType: "apartment",
  items: selected,
  roomCounts: { bathroom: 2, bedroom: 3 },
  itemDifficulties: [{ category: "bathroom", item: "Toilet", difficulty: 1 }],
  removedGeneratedKeys: [removedId],
  recurrenceOverrides: { [trashId]: "biweekly" },
  customChores: ["Wash towels", "  wash   towels  ", "Water plants"],
  customChoreSettings: {
    "Wash towels": {
      category: "laundry",
      recurrence: "everyThreeDays",
      points: 25,
    },
    "  wash   towels  ": {
      category: "laundry",
      recurrence: "everyThreeDays",
      points: 25,
    },
    "Water plants": { category: "other", recurrence: "weekly", points: 5 },
  },
});
assert.ok(
  !plan.tasks.some((task) => task.id === removedId),
  "removed preview tasks must not reappear on initial creation",
);
assert.equal(
  plan.tasks.find((task) => task.id === trashId)?.frequency,
  "biweekly",
  "a manual recurrence choice must survive preview-to-chart conversion",
);
assert.equal(
  plan.generatedTasks.find((task) => task.title.startsWith("Clean toilet"))
    ?.difficulty,
  1,
  "saved household weights must affect setup before creating any chores",
);
assert.equal(
  plan.customTasks.length,
  2,
  "stable normalized custom IDs must deduplicate resumed setup chores",
);
assert.equal(
  setupCustomTaskId(householdId, "Wash towels"),
  setupCustomTaskId(householdId, " wash  towels "),
);
assert.notEqual(
  setupCustomTaskId(householdId, "Wash towels"),
  setupCustomTaskId("another-household", "Wash towels"),
);
const laundryTask = plan.tasks.find(
  (task) => task.id === setupCustomTaskId(householdId, "Wash towels"),
)!;
assert.equal(
  laundryTask.itemCategory,
  "laundry",
  "setup custom categories must survive future planner generation",
);
assert.equal(laundryTask.frequency, "everyThreeDays");
assert.equal(laundryTask.difficulty, 4);

const now = new Date("2026-03-07T23:30:00.000Z");
const timezone = "America/New_York";
const members = [{ id: "a" }, { id: "b" }];
const preferences = [
  { householdId, memberId: "a", key: "morning", value: 100 },
  { householdId, memberId: "a", key: "night", value: 0 },
  { householdId, memberId: "b", key: "morning", value: 0 },
  { householdId, memberId: "b", key: "night", value: 100 },
];
const payload = buildHouseholdChart({
  householdId,
  tasks: plan.tasks,
  members,
  preferences,
  chores: [],
  now,
  timezone,
});
const created = materializeApprovedChart({
  payload,
  chores: [],
  members,
  householdId,
  chartId: `setup:${householdId}`,
  creatorId: "a",
  now,
  timezone,
});
assert.equal(created.length, plan.tasks.length);
assert.ok(
  created.some((chore) => chore.assignedTo === "b"),
  "setup must balance available members instead of assigning every chore to its creator",
);
assert.ok(
  created.every(
    (chore) =>
      chore.assignmentMode === "round-robin" &&
      chore.roundRobinAllMembers &&
      chore.roundRobinParticipantIds?.length === 2,
  ),
  "initial setup chores must rotate among eligible roommates every occurrence",
);
for (const task of plan.tasks) {
  const chore = created.find((entry) => entry.sourceKey === task.id)!;
  assert.ok(
    chore,
    `preview task ${task.id} must have exactly one created series`,
  );
  assert.equal(chore.points, pointsForDifficulty(task.difficulty));
  assert.equal(chore.recurring, task.frequency);
}
const createdLaundry = created.find(
  (chore) => chore.sourceKey === laundryTask.id,
)!;
assert.equal(createdLaundry.category, "laundry");
assert.equal(createdLaundry.points, 25);
assert.equal(createdLaundry.scheduledDate, "2026-03-10");
const morning = created.find((chore) => chore.timeOfDay === "morning")!;
assert.equal(morning.scheduledDate, "2026-03-08");
assert.equal(
  morning.dueDate,
  "2026-03-08T13:00:00.000Z",
  "initial household due dates must honor DST and morning task timing",
);
const resumed = materializeApprovedChart({
  payload,
  chores: [],
  members,
  householdId,
  chartId: `setup:${householdId}`,
  creatorId: "a",
  now,
  timezone,
});
assert.deepEqual(
  resumed.map((chore) => chore.id),
  created.map((chore) => chore.id),
  "a repeated setup submission must retain stable chore identities",
);
console.log("Household setup chore pipeline tests passed");
