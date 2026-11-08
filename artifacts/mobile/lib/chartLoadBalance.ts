import type { Assignment, GeneratedTask } from "../context/AppContext";
import { taskLoad } from "./choreEngine.ts";

/** Fractional distance from the household average required for a warning. */
export const LOAD_DEVIATION_PERCENT_THRESHOLD = 0.25;

/** Minimum weekly-load gap required, preventing tiny charts from warning. */
export const LOAD_DEVIATION_ABSOLUTE_FLOOR = 2;

export interface LoadDeviation {
  memberId: string;
  load: number;
  average: number;
  direction: "above" | "below";
  percentFromAverage: number;
}

/**
 * Recomputes approved assignment totals from their tasks rather than trusting
 * cached totals or looking at completed chores. Include the saved workload
 * baseline from the same chart so unmanaged chores are counted consistently.
 */
export function findAssignedLoadDeviations(
  assignments: Assignment[],
  tasks: GeneratedTask[],
  percentThreshold = LOAD_DEVIATION_PERCENT_THRESHOLD,
  absoluteFloor = LOAD_DEVIATION_ABSOLUTE_FLOOR,
  existingLoads: Record<string, number> = {},
): LoadDeviation[] {
  if (!assignments.length) return [];

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const totals = assignments.map((assignment) => ({
    memberId: assignment.memberId,
    load: assignment.taskIds.reduce((sum, taskId) => {
      const task = tasksById.get(taskId);
      return sum + (task ? taskLoad(task, true) : 0);
    }, existingLoads[assignment.memberId] ?? 0),
  }));
  const average =
    totals.reduce((sum, member) => sum + member.load, 0) / totals.length;
  if (average <= 0) return [];

  return totals.flatMap((member) => {
    const gap = member.load - average;
    const percentFromAverage = Math.abs(gap) / average;
    if (
      Math.abs(gap) <= absoluteFloor ||
      percentFromAverage <= percentThreshold
    ) {
      return [];
    }
    return [{
      memberId: member.memberId,
      load: member.load,
      average,
      direction: gap > 0 ? "above" : "below",
      percentFromAverage,
    }];
  });
}
