import type { Chore } from "../context/AppContext";

/**
 * Row shape for the normalized `chores` table (see the
 * 202608260001_chores_table migration). This is Phase 1 of moving chores off
 * the household_states JSON blob: the app still reads from the blob, but
 * every local chore change is also shadow-written here so the schema and
 * data can be verified before any read path switches over.
 */
export type ChoreRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  creator_id: string | null;
  assigned_to: string | null;
  assignment_mode: "specific-person" | "round-robin" | "unassigned";
  round_robin_participant_ids: string[];
  round_robin_all_members: boolean;
  round_robin_cursor: number;
  excluded_participant_ids: string[];
  due_date: string;
  initial_due_date: string | null;
  next_due_date: string | null;
  scheduled_date: string | null;
  initial_scheduled_date: string | null;
  monthly_anchor_day: number | null;
  excluded_occurrence_dates: string[];
  recurrence_ends_on: string | null;
  completed: boolean;
  completed_at: string | null;
  completed_by_user_id: string | null;
  points: number;
  category: string;
  recurring: string | null;
  recurrence_series_id: string | null;
  occurrence_index: number | null;
  next_occurrence_id: string | null;
  source_key: string | null;
  created_at: string;
  updated_at: string;
};

/** Returns null for chores that cannot be shadow-written yet (no household assigned). */
export function choreToRow(chore: Chore): ChoreRow | null {
  if (!chore.householdId) return null;
  return {
    id: chore.id,
    household_id: chore.householdId,
    title: chore.title,
    description: chore.description ?? null,
    creator_id: chore.creatorId ?? null,
    // assignedTo uses "" to mean unassigned; the column is a real uuid FK,
    // so that has to become null rather than an invalid empty-string uuid.
    assigned_to: chore.assignedTo || null,
    assignment_mode: chore.assignmentMode ?? "specific-person",
    round_robin_participant_ids: chore.roundRobinParticipantIds ?? [],
    round_robin_all_members: chore.roundRobinAllMembers ?? false,
    round_robin_cursor: chore.roundRobinCursor ?? 0,
    excluded_participant_ids: chore.excludedParticipantIds ?? [],
    due_date: chore.dueDate,
    initial_due_date: chore.initialDueDate ?? null,
    next_due_date: chore.nextDueDate ?? null,
    scheduled_date: chore.scheduledDate ?? null,
    initial_scheduled_date: chore.initialScheduledDate ?? null,
    monthly_anchor_day: chore.monthlyAnchorDay ?? null,
    excluded_occurrence_dates: chore.excludedOccurrenceDates ?? [],
    recurrence_ends_on: chore.recurrenceEndsOn ?? null,
    completed: chore.completed,
    completed_at: chore.completedAt ?? null,
    completed_by_user_id: chore.completedByUserId ?? null,
    points: chore.points,
    category: chore.category,
    recurring: chore.recurring ?? null,
    recurrence_series_id: chore.recurrenceSeriesId ?? null,
    occurrence_index: chore.occurrenceIndex ?? null,
    next_occurrence_id: chore.nextOccurrenceId ?? null,
    source_key: chore.sourceKey ?? null,
    created_at: chore.createdAt ?? new Date().toISOString(),
    updated_at: chore.updatedAt ?? new Date().toISOString(),
  };
}

/** Inverse of choreToRow, for the future read-path cutover. */
export function rowToChore(row: ChoreRow): Chore {
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    description: row.description ?? undefined,
    creatorId: row.creator_id ?? undefined,
    assignedTo: row.assigned_to ?? "",
    assignmentMode: row.assignment_mode,
    roundRobinParticipantIds: row.round_robin_participant_ids.length
      ? row.round_robin_participant_ids
      : undefined,
    roundRobinAllMembers: row.round_robin_all_members,
    roundRobinCursor: row.round_robin_cursor,
    excludedParticipantIds: row.excluded_participant_ids.length
      ? row.excluded_participant_ids
      : undefined,
    dueDate: row.due_date,
    initialDueDate: row.initial_due_date ?? undefined,
    nextDueDate: row.next_due_date ?? undefined,
    scheduledDate: row.scheduled_date ?? undefined,
    initialScheduledDate: row.initial_scheduled_date ?? undefined,
    monthlyAnchorDay: row.monthly_anchor_day ?? undefined,
    excludedOccurrenceDates: row.excluded_occurrence_dates.length
      ? row.excluded_occurrence_dates
      : undefined,
    recurrenceEndsOn: row.recurrence_ends_on ?? undefined,
    completed: row.completed,
    completedAt: row.completed_at ?? undefined,
    completedByUserId: row.completed_by_user_id ?? undefined,
    points: row.points,
    category: row.category as Chore["category"],
    recurring: (row.recurring ?? undefined) as Chore["recurring"],
    recurrenceSeriesId: row.recurrence_series_id ?? undefined,
    occurrenceIndex: row.occurrence_index ?? undefined,
    nextOccurrenceId: row.next_occurrence_id ?? undefined,
    sourceKey: row.source_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
