import type { ChartApproval } from "../context/AppContext";

/** A vote only belongs to its exact chart version and an active roster member. */
export function chartApprovalProgress(
  chartId: string | null,
  members: readonly { id: string; name: string }[],
  approvals: readonly ChartApproval[],
) {
  const approvedIds = new Set(approvals.filter((approval) => approval.proposedChartId === chartId && approval.approved).map((approval) => approval.memberId));
  const rows = members.map((member) => ({ ...member, approved: approvedIds.has(member.id) }));
  return { rows, approvedCount: rows.filter((row) => row.approved).length, totalCount: rows.length };
}
