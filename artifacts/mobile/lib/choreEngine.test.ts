import type { GeneratedTask, MemberPreference } from "../context/AppContext";
import {
  buildBalancedChart,
  eligibleMemberIdsForTask,
  loadSpread,
  taskLoad,
} from "./choreEngine.ts";
import { findAssignedLoadDeviations } from "./chartLoadBalance.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function rejects(action: () => unknown, message: string) {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  assert(rejected, message);
}

const members = [{ id: "a" }, { id: "b" }];
function task(id: string, difficulty: GeneratedTask["difficulty"], extra: Partial<GeneratedTask> = {}): GeneratedTask {
  return {
    id, itemCategory: "kitchen", item: id, title: id,
    frequency: "weekly", timeOfDay: "any", difficulty, ...extra,
  };
}
function preference(memberId: string, key: string, value: number): MemberPreference {
  return { householdId: "house", memberId, key, value };
}
function owner(chart: ReturnType<typeof buildBalancedChart>, taskId: string) {
  return chart.assignments.find((assignment) => assignment.taskIds.includes(taskId))?.memberId;
}
function total(chart: ReturnType<typeof buildBalancedChart>, memberId: string) {
  return chart.memberLoads?.find((member) => member.memberId === memberId)?.totalLoad;
}

const tasks = [
  task("daily", 2, { frequency: "daily" }),
  task("weekly-a", 5, { timeOfDay: "morning" }),
  task("weekly-b", 4, { timeOfDay: "night" }),
];
assert(taskLoad(tasks[0]) === 14, "daily task load must be frequency weighted");
assert(taskLoad(tasks[0], false) === 2, "raw difficulty mode must ignore frequency");
assert(taskLoad(task("alternate", 2, { frequency: "everyOtherDay" })) === 7, "alternating days must contribute half the daily weekly load");
assert(taskLoad(task("biweekly", 2, { frequency: "biweekly" })) === 1, "biweekly work must contribute half its difficulty per week");
assert(Math.abs(taskLoad(task("three-day", 2, { frequency: "everyThreeDays" as GeneratedTask["frequency"] })) - 14 / 3) < 1e-9, "every-three-day work must retain its exact weekly load");
const chart = buildBalancedChart(tasks, members);
assert(chart.assignments.flatMap((assignment) => assignment.taskIds).sort().join(",") === "daily,weekly-a,weekly-b", "every task must be assigned once");
assert(loadSpread(chart.memberLoads ?? []) <= 5, "this fixture's indivisible daily task must still be balanced");

const pinned = buildBalancedChart(tasks, members, [], { pinnedAssignments: { daily: "b" } });
assert(owner(pinned, "daily") === "b", "pinned tasks must use the selected member");
const reservePinned = buildBalancedChart([task("free-heavy", 5), task("pinned-light", 4)], members, [], {
  pinnedAssignments: { "pinned-light": "a" },
});
assert(total(reservePinned, "a") === 4 && total(reservePinned, "b") === 5, "reserve pinned load before assigning heavier free work instead of producing 9/0");
const reserveForced = buildBalancedChart([task("free-heavy", 5), task("forced-light", 4)], members, [], {
  excludedAssignments: { "forced-light": ["b"] },
});
assert(total(reserveForced, "a") === 4 && total(reserveForced, "b") === 5, "single-eligible-member work must be reserved just like an explicit pin");

const grouped = [task("group-a", 2, { keepTogetherGroup: "shared" }), task("group-b", 2, { keepTogetherGroup: "shared" })];
const conflictPins = buildBalancedChart(grouped, members, [], {
  pinnedAssignments: { "group-a": "a", "group-b": "b" },
});
assert(owner(conflictPins, "group-a") === "a" && owner(conflictPins, "group-b") === "b", "conflicting individual pins must split a soft group, never silently override a pin");
const conflictExclusions = buildBalancedChart(grouped, members, [], {
  excludedAssignments: { "group-a": ["b"], "group-b": ["a"] },
});
assert(owner(conflictExclusions, "group-a") === "a" && owner(conflictExclusions, "group-b") === "b", "incompatible exclusions must also split a group");
const keepTogether = buildBalancedChart([...grouped, task("other", 4)], members);
assert(owner(keepTogether, "group-a") === owner(keepTogether, "group-b"), "compatible groups must remain together during balancing and optimization");
const cumulative = buildBalancedChart([task("one", 2), task("two", 3), task("three", 4)], members, [], {
  pinnedAssignments: { one: "a", two: "b" }, excludedAssignments: { three: ["a"] },
});
assert(owner(cumulative, "one") === "a" && owner(cumulative, "two") === "b" && owner(cumulative, "three") === "b", "all saved pins and exclusions must be honored together");

const baseline = buildBalancedChart([task("new-work", 4)], members, [], { existingLoads: { a: 6, b: 0 } });
assert(owner(baseline, "new-work") === "b", "existing unmanaged workload must influence the first assignment");
assert(total(baseline, "a") === 6 && total(baseline, "b") === 4, "displayed totals must include baseline workload without fabricating task IDs");
const empty = buildBalancedChart([], members, [], { existingLoads: { a: 3, b: 1 } });
assert(total(empty, "a") === 3 && empty.assignments.every((assignment) => !assignment.taskIds.length), "empty regeneration must retain the existing workload summary");
const deviations = findAssignedLoadDeviations(baseline.assignments, [task("new-work", 4)], 0.25, 2, { a: 6, b: 0 });
assert(deviations.length === 0, "load warnings must use baseline plus generated work, matching the engine totals");

const improvingFixture = [3, 3, 2, 2, 2].map((difficulty, index) => task(`balance-${index}`, difficulty as GeneratedTask["difficulty"]));
const improved = buildBalancedChart(improvingFixture, members);
assert(total(improved, "a") === 6 && total(improved, "b") === 6, "a local move/swap must resolve the simple 7/5 greedy result to 6/6");
const reversed = buildBalancedChart([...improvingFixture].reverse(), [...members].reverse());
assert(improved.assignments.every((assignment) =>
  reversed.assignments.find((entry) => entry.memberId === assignment.memberId)?.taskIds.join(",") === assignment.taskIds.join(",")
), "equivalent task and roster ordering must produce the same deterministic assignments");

const timeTasks = [task("morning", 3, { timeOfDay: "morning", keepTogetherGroup: "time" }), task("night", 3, { timeOfDay: "night", keepTogetherGroup: "time" })];
const oppositePreferences = [preference("a", "morning", 100), preference("a", "night", 0), preference("b", "morning", 0), preference("b", "night", 100)];
const preferred = buildBalancedChart(timeTasks, members, oppositePreferences, { mode: "preference" });
assert(owner(preferred, "morning") === "a" && owner(preferred, "night") === "b", "opposite morning/night preferences must split a soft group and select the matching person");
const hardExclusion = buildBalancedChart(timeTasks, members, oppositePreferences, {
  mode: "preference", excludedAssignments: { morning: ["a"] },
});
assert(owner(hardExclusion, "morning") === "b", "a high preference must never override a hard exclusion");
const neutral = buildBalancedChart(timeTasks.map((entry) => ({ ...entry, keepTogetherGroup: undefined })), members, oppositePreferences, { mode: "perfectSplit" });
assert(loadSpread(neutral.memberLoads ?? []) === 0, "perfect split must preserve balance independently of saved preferences");
const soft = buildBalancedChart(Array.from({ length: 6 }, (_, index) => task(`soft-${index}`, 2, { timeOfDay: "morning" })), members,
  [preference("a", "morning", 100), preference("b", "morning", 0)], { mode: "preference" });
assert(loadSpread(soft.memberLoads ?? []) === 0, "soft preferences must not concentrate an entire household's work on the preferred person");
assert(eligibleMemberIdsForTask("morning", members, { excludedAssignments: { morning: ["a"] } }).join(",") === "b", "recurrence eligibility must share hard exclusions");
assert(eligibleMemberIdsForTask("morning", members, { pinnedAssignments: { morning: "a" } }).join(",") === "a", "an always-assigned pin must keep recurrence with that person");

rejects(() => buildBalancedChart(tasks, []), "reject an empty member list");
rejects(() => buildBalancedChart(tasks, [{ id: "a" }, { id: "a" }]), "reject duplicate members rather than collapsing their workload");
rejects(() => buildBalancedChart([tasks[0], tasks[0]], members), "reject duplicate task IDs rather than assigning an occurrence twice");
rejects(() => buildBalancedChart([task("invalid", Number.NaN as GeneratedTask["difficulty"])], members), "reject non-finite difficulty");
rejects(() => buildBalancedChart([task("invalid", 6 as GeneratedTask["difficulty"])], members), "reject difficulty outside the supported scale");
rejects(() => buildBalancedChart([task("invalid", 2, { frequency: "unknown" as GeneratedTask["frequency"] })], members), "reject unknown recurrences rather than producing NaN totals");
rejects(() => buildBalancedChart(tasks, members, [], { existingLoads: { a: Number.NaN } }), "reject invalid baseline workload");
rejects(() => buildBalancedChart(tasks, members, [], { existingLoads: { a: -1 } }), "reject negative baseline workload");
rejects(() => buildBalancedChart(tasks, members, [preference("a", "morning", Number.NaN)]), "reject malformed stored preferences");
rejects(() => buildBalancedChart(tasks, members, [], { preferenceWeight: Number.NaN }), "reject non-finite preference configuration");
rejects(() => buildBalancedChart([tasks[0]], [{ id: "a" }], [], { excludedAssignments: { daily: ["a"] } }), "reject tasks with no eligible member");
rejects(() => buildBalancedChart(tasks, members, [], { pinnedAssignments: { daily: "departed" } }), "reject stale pins instead of assigning them to someone else");
rejects(() => buildBalancedChart(tasks, members, [], { pinnedAssignments: { daily: "a" }, excludedAssignments: { daily: ["a"] } }), "reject contradictory pin/exclusion on one task");

const prototypeIds = buildBalancedChart([task("constructor", 2)], [{ id: "toString" }], [], { pinnedAssignments: {}, excludedAssignments: {}, existingLoads: {} });
assert(owner(prototypeIds, "constructor") === "toString", "ordinary object prototype names must remain valid task and member IDs");


// Exercise combinations of baseline workload, pins, exclusions and recurrence.
for (let fixture = 0; fixture < 20; fixture += 1) {
  const roster = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const generated = Array.from({ length: 9 }, (_, index) => task(`fixture-${fixture}-${index}`, ((fixture + index) % 5 + 1) as GeneratedTask["difficulty"], {
    frequency: index % 3 === 0 ? "daily" : index % 3 === 1 ? "biweekly" : "weekly",
  }));
  const constraints = {
    pinnedAssignments: { [generated[0].id]: "a", [generated[1].id]: "b" },
    excludedAssignments: { [generated[2].id]: ["a", "b"], [generated[3].id]: ["c"] },
    existingLoads: { a: fixture % 7, b: fixture % 3, c: fixture % 5 },
  };
  const result = buildBalancedChart(generated, roster, [], constraints);
  const assignedIds = result.assignments.flatMap((assignment) => assignment.taskIds);
  assert(assignedIds.length === generated.length && new Set(assignedIds).size === generated.length, "every generated occurrence must be assigned exactly once across constraint combinations");
  for (const assignment of result.assignments) {
    const calculated = generated.filter((entry) => assignment.taskIds.includes(entry.id)).reduce((sum, entry) => sum + taskLoad(entry), constraints.existingLoads[assignment.memberId as keyof typeof constraints.existingLoads]);
    assert(Math.abs(calculated - assignment.totalLoad) < 1e-8, "reported totals must conserve generated and baseline load after optimization");
    assert(assignment.taskIds.every((taskId) => eligibleMemberIdsForTask(taskId, roster, constraints).includes(assignment.memberId)), "optimization must never violate any hard eligibility constraint");
  }
}
