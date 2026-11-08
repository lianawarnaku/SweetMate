import { occurrencesPerWeek } from "../constants/choreRules.ts";
import type {
  Assignment,
  GeneratedTask,
  MemberLoad,
  MemberPreference,
  ProposedChart,
} from "../context/AppContext";

export type ChoreEngineMode = "perfectSplit" | "preference";

export interface ChoreEngineMember {
  id: string;
}

export interface ChoreEngineOptions {
  mode?: ChoreEngineMode;
  /** When false, load is raw difficulty. Defaults to true. */
  frequencyWeighted?: boolean;
  /** Soft influence on close choices, bounded to 0–0.35. Defaults to 0.2. */
  preferenceWeight?: number;
  /** A value at or below this threshold may break a keep-together group. */
  strongAversionThreshold?: number;
  pinnedAssignments?: Record<string, string>;
  excludedAssignments?: Record<string, string[]>;
  /** Weekly workload already assigned outside this generated chart. */
  existingLoads?: Record<string, number>;
}

export type ChoreEnginePayload = Pick<
  ProposedChart["payload"],
  "assignments" | "memberLoads" | "generatedTasks"
>;

type AssignmentConstraints = Pick<
  ChoreEngineOptions,
  "pinnedAssignments" | "excludedAssignments"
>;

interface WorkUnit {
  key: string;
  tasks: GeneratedTask[];
  load: number;
  eligibleIds: string[];
  preferenceCosts: Map<string, number>;
}

const DEFAULT_PREFERENCE = 50;
const EPSILON = 1e-9;

function ownValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function taskLoad(task: GeneratedTask, frequencyWeighted = true): number {
  const occurrences = occurrencesPerWeek(task.frequency);
  if (
    !Number.isInteger(task.difficulty) || task.difficulty < 1 || task.difficulty > 5 ||
    !Number.isFinite(occurrences) || occurrences <= 0
  ) {
    throw new Error(`Invalid difficulty or recurrence for task ${task.id}.`);
  }
  return task.difficulty * (frequencyWeighted ? occurrences : 1);
}

/** Shared by first-assignment balancing and each recurring rotation. */
export function eligibleMemberIdsForTask(
  taskId: string,
  members: ChoreEngineMember[],
  options: AssignmentConstraints = {},
): string[] {
  const pinnedId = ownValue(options.pinnedAssignments, taskId);
  if (pinnedId !== undefined && !members.some((member) => member.id === pinnedId)) {
    throw new Error(`The pinned member for task ${taskId} is not in this household.`);
  }
  const exclusions = ownValue(options.excludedAssignments, taskId) ?? [];
  if (!Array.isArray(exclusions) || exclusions.some((memberId) => typeof memberId !== "string")) {
    throw new Error(`Invalid excluded members for task ${taskId}.`);
  }
  const eligible = members
    .filter((member) => (!pinnedId || member.id === pinnedId) && !exclusions.includes(member.id))
    .map((member) => member.id);
  if (!eligible.length) throw new Error(`No eligible member can be assigned task ${taskId}.`);
  return eligible;
}

function preferenceValue(
  preferences: Map<string, number>, memberId: string, key: string,
): number {
  return preferences.get(JSON.stringify([memberId, key])) ?? DEFAULT_PREFERENCE;
}

function buildWorkUnits(
  tasks: GeneratedTask[],
  members: ChoreEngineMember[],
  preferences: Map<string, number>,
  options: ChoreEngineOptions & {
    mode: ChoreEngineMode;
    frequencyWeighted: boolean;
    preferenceWeight: number;
    strongAversionThreshold: number;
  },
): WorkUnit[] {
  const grouped = new Map<string, GeneratedTask[]>();
  const eligibility = new Map(tasks.map((task) => [
    task.id, eligibleMemberIdsForTask(task.id, members, options),
  ]));
  for (const task of tasks) {
    const key = task.keepTogetherGroup ? `group:${task.keepTogetherGroup}` : `task:${task.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }

  const units: WorkUnit[] = [];
  for (const [key, group] of grouped) {
    const groupedTasks = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const commonIds = members.map((member) => member.id).filter((memberId) =>
      groupedTasks.every((task) => eligibility.get(task.id)!.includes(memberId))
    );
    const hasStrongAversion = options.mode === "preference" && groupedTasks.some((task) =>
      task.timeOfDay !== "any" && eligibility.get(task.id)!.some((memberId) =>
        preferenceValue(preferences, memberId, task.timeOfDay) <= options.strongAversionThreshold
      )
    );
    // A soft grouping must never override individual pins or exclusions.
    const split = groupedTasks.length > 1 && (!commonIds.length || hasStrongAversion);
    for (const unitTasks of split ? groupedTasks.map((task) => [task]) : [groupedTasks]) {
      const load = unitTasks.reduce((sum, task) => sum + taskLoad(task, options.frequencyWeighted), 0);
      const eligibleIds = split ? eligibility.get(unitTasks[0].id)! : commonIds;
      const preferenceCosts = new Map(eligibleIds.map((memberId) => {
        const penalty = options.mode === "preference" ? unitTasks.reduce((sum, task) => {
          if (task.timeOfDay === "any") return sum;
          const direction = (DEFAULT_PREFERENCE - preferenceValue(preferences, memberId, task.timeOfDay)) / DEFAULT_PREFERENCE;
          return sum + taskLoad(task, options.frequencyWeighted) * direction * options.preferenceWeight;
        }, 0) : 0;
        return [memberId, 2 * load * penalty] as const;
      }));
      units.push({
        key: split ? `task:${unitTasks[0].id}` : key,
        tasks: unitTasks,
        load,
        eligibleIds,
        preferenceCosts,
      });
    }
  }
  return units.sort((a, b) =>
    // Reserve all forced work before allocating any freely assignable work.
    Number(b.eligibleIds.length === 1) - Number(a.eligibleIds.length === 1) ||
    b.load - a.load || a.key.localeCompare(b.key)
  );
}

function tieRank(unitKey: string, memberId: string): number {
  // Seed exact ties by task and member, avoiding a permanent first-roster bias.
  let hash = 2166136261;
  for (const character of JSON.stringify([unitKey, memberId])) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

/** Bounded move/swap search removes straightforward greedy imbalances. */
function improveAssignments(
  units: WorkUnit[], owners: string[], totals: Map<string, number>,
): void {
  let evaluations = 0;
  const maxEvaluations = 50_000;
  for (let pass = 0; pass < 30 && evaluations < maxEvaluations; pass += 1) {
    let bestDelta = -EPSILON;
    let bestMove: { first: number; target: string; second?: number } | undefined;
    for (let first = 0; first < units.length && evaluations < maxEvaluations; first += 1) {
      const unit = units[first];
      const owner = owners[first];
      if (unit.eligibleIds.length === 1) continue;
      for (const target of unit.eligibleIds) {
        if (target === owner || evaluations >= maxEvaluations) continue;
        evaluations += 1;
        const fromLoad = totals.get(owner)!;
        const toLoad = totals.get(target)!;
        const delta = 2 * unit.load * (toLoad - fromLoad + unit.load) +
          unit.preferenceCosts.get(target)! - unit.preferenceCosts.get(owner)!;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = { first, target };
        }
      }
      for (let second = first + 1; second < units.length && evaluations < maxEvaluations; second += 1) {
        const other = units[second];
        const target = owners[second];
        if (target === owner || !unit.eligibleIds.includes(target) || !other.eligibleIds.includes(owner)) continue;
        evaluations += 1;
        const transfer = unit.load - other.load;
        const delta = 2 * transfer * (totals.get(target)! - totals.get(owner)! + transfer) +
          unit.preferenceCosts.get(target)! - unit.preferenceCosts.get(owner)! +
          other.preferenceCosts.get(owner)! - other.preferenceCosts.get(target)!;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = { first, target, second };
        }
      }
    }
    if (!bestMove) break;
    const { first, target, second } = bestMove;
    const owner = owners[first];
    const transfer = units[first].load - (second === undefined ? 0 : units[second].load);
    totals.set(owner, totals.get(owner)! - transfer);
    totals.set(target, totals.get(target)! + transfer);
    owners[first] = target;
    if (second !== undefined) owners[second] = owner;
  }
}

/**
 * Deterministic balancing with hard eligibility, existing workload and soft
 * time preferences. Total loads include existingLoads; taskIds contain only
 * this chart's tasks. Keep-together groups split when hard constraints conflict.
 */
export function buildBalancedChart(
  tasks: GeneratedTask[],
  members: ChoreEngineMember[],
  preferences: MemberPreference[] = [],
  options: ChoreEngineOptions = {},
): ChoreEnginePayload {
  if (!members.length) throw new Error("At least one household member is required.");
  const memberIds = new Set<string>();
  for (const member of members) {
    if (typeof member.id !== "string" || !member.id.trim() || memberIds.has(member.id)) {
      throw new Error("Household members must have unique, nonempty IDs.");
    }
    memberIds.add(member.id);
  }
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== "string" || !task.id.trim() || taskIds.has(task.id)) {
      throw new Error("Generated tasks must have unique, nonempty IDs.");
    }
    taskIds.add(task.id);
    taskLoad(task, options.frequencyWeighted);
    if (!["any", "morning", "night"].includes(task.timeOfDay)) {
      throw new Error(`Invalid time preference for task ${task.id}.`);
    }
  }
  const mode = options.mode ?? "perfectSplit";
  if (mode !== "perfectSplit" && mode !== "preference") throw new Error("Unknown chore assignment mode.");
  const frequencyWeighted = options.frequencyWeighted ?? true;
  if (typeof frequencyWeighted !== "boolean") throw new Error("Frequency weighting must be true or false.");
  const weight = options.preferenceWeight ?? 0.2;
  const threshold = options.strongAversionThreshold ?? 10;
  if (!Number.isFinite(weight) || !Number.isFinite(threshold)) throw new Error("Preference settings must be finite numbers.");
  const preferenceValues = new Map<string, number>();
  for (const preference of preferences) {
    if (!memberIds.has(preference.memberId) || !["morning", "night"].includes(preference.key)) continue;
    if (!Number.isFinite(preference.value) || preference.value < 0 || preference.value > 100) {
      throw new Error("Member preferences must be between 0 and 100.");
    }
    preferenceValues.set(JSON.stringify([preference.memberId, preference.key]), preference.value);
  }
  const totals = new Map(members.map((member) => {
    const baseline = ownValue(options.existingLoads, member.id) ?? 0;
    if (!Number.isFinite(baseline) || baseline < 0 || baseline > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Existing workload for ${member.id} must be a nonnegative finite number.`);
    }
    return [member.id, baseline] as const;
  }));
  const orderedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const units = buildWorkUnits(tasks, orderedMembers, preferenceValues, {
    ...options,
    mode,
    frequencyWeighted,
    preferenceWeight: Math.max(0, Math.min(0.35, weight)),
    strongAversionThreshold: Math.max(0, Math.min(100, threshold)),
  });
  const owners = units.map((unit) => {
    let selected = unit.eligibleIds[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const memberId of unit.eligibleIds) {
      const score = 2 * totals.get(memberId)! * unit.load + unit.load ** 2 + unit.preferenceCosts.get(memberId)!;
      if (score < bestScore - EPSILON || (
        Math.abs(score - bestScore) <= EPSILON &&
        (tieRank(unit.key, memberId) < tieRank(unit.key, selected) ||
          (tieRank(unit.key, memberId) === tieRank(unit.key, selected) && memberId.localeCompare(selected) < 0))
      )) {
        selected = memberId;
        bestScore = score;
      }
    }
    totals.set(selected, totals.get(selected)! + unit.load);
    return selected;
  });
  improveAssignments(units, owners, totals);

  const taskIdsByMember = new Map(members.map((member) => [member.id, [] as string[]]));
  units.forEach((unit, index) => taskIdsByMember.get(owners[index])!.push(...unit.tasks.map((task) => task.id)));
  const memberLoads: MemberLoad[] = members.map((member) => ({
    memberId: member.id, totalLoad: totals.get(member.id)!,
  }));
  const assignments: Assignment[] = members.map((member) => ({
    memberId: member.id,
    taskIds: taskIdsByMember.get(member.id)!.sort(),
    totalLoad: totals.get(member.id)!,
  }));
  return { assignments, memberLoads, generatedTasks: tasks };
}

export function loadSpread(memberLoads: MemberLoad[]): number {
  if (memberLoads.length < 2) return 0;
  const loads = memberLoads.map((member) => member.totalLoad);
  return Math.max(...loads) - Math.min(...loads);
}
