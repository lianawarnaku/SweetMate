import type { ChartApproval, ProposedChart } from "../context/AppContext";

export interface ChoreChartReviewDraft {
  householdId: string;
  payload: ProposedChart["payload"];
  baseChartId: string | null;
  approvedChartId: string | null;
  submittedChartId?: string | null;
}

type ReviewState =
  | { kind: "draft" | "stale"; chartId: null }
  | { kind: "pending" | "approved"; chartId: string };

// Postgres jsonb can return object keys in a different order. That alone must
// never turn an existing proposal into a replacement that loses its approvals.
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortedJson(entry)]));
  }
  return value;
}

export function choreChartReviewState({ draft, currentChart, householdId, inputsChanged }: {
  draft: ChoreChartReviewDraft;
  currentChart: ProposedChart | null;
  householdId: string | null;
  inputsChanged: boolean;
}): ReviewState {
  if (draft.householdId !== householdId || (currentChart && currentChart.householdId !== householdId)) {
    return { kind: "stale", chartId: null };
  }
  const shared = currentChart?.status === "pending" || currentChart?.status === "approved" ? currentChart : null;
  const matches = shared && JSON.stringify(sortedJson(shared.payload)) === JSON.stringify(sortedJson(draft.payload));
  const confirmedChartId = draft.submittedChartId ?? draft.approvedChartId;
  if (confirmedChartId) {
    // Applying a chart changes saved chores. Keep the just-approved review open,
    // while refusing to approve a later revision without previewing it first.
    if (shared?.id !== confirmedChartId || !matches) return { kind: "stale", chartId: null };
  } else if (inputsChanged) {
    return { kind: "stale", chartId: null };
  }
  if (!confirmedChartId && (shared?.id ?? null) !== draft.baseChartId) return { kind: "stale", chartId: null };
  if (shared && matches) return { kind: shared.status === "approved" ? "approved" : "pending", chartId: shared.id };
  return { kind: "draft", chartId: null };
}

/** Permanent-rule changes always start a fresh review with everyone Pending. */
export function choreChartReviewSubmission(state: ReviewState, ruleChanges: boolean) {
  if (state.kind === "stale" || state.kind === "approved") return null;
  return {
    replace: ruleChanges || state.kind === "draft",
    approveSelf: !ruleChanges,
  };
}


export interface ChoreChartReviewSnapshot {
  householdId: string;
  chart: ProposedChart | null;
  approvals: ChartApproval[];
}

export function parseChoreChartReviewSnapshot(data: unknown, householdId: string): ChoreChartReviewSnapshot {
  if (!data || typeof data !== "object") throw new Error("The chore chart review is unavailable.");
  const raw = data as Record<string, any>;
  if (raw.householdId !== householdId || !Array.isArray(raw.approvals)) throw new Error("The chore chart review belongs to another household.");
  const row = raw.chart;
  if (row === null) return { householdId, chart: null, approvals: [] };
  if (!row || row.household_id !== householdId || typeof row.id !== "string" || !["pending", "approved"].includes(row.status) || !row.payload || typeof row.payload !== "object") throw new Error("The saved chore chart could not be loaded.");
  const chart: ProposedChart = { id: row.id, householdId, createdBy: row.created_by, status: row.status,
    payload: row.payload, createdAt: row.created_at, appliedAt: row.applied_at };
  const approvals: ChartApproval[] = raw.approvals.filter((vote: any) => vote.household_id === householdId && vote.proposed_chart_id === chart.id && typeof vote.member_id === "string")
    .map((vote: any) => ({ id: vote.id, proposedChartId: chart.id, memberId: vote.member_id, approved: vote.approved === true, approvedAt: vote.approved_at ?? "" }));
  return { householdId, chart, approvals };
}
