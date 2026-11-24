import type { AppAlert } from "../context/AppContext";

export interface ChartRestartNotification {
  id: string;
  household_id: string;
  chart_id: string;
  actor_id: string | null;
  actor_name: string;
  recipient_id: string;
  created_at: string;
  read_at: string | null;
}

export function chartRestartAlerts(rows: ChartRestartNotification[], householdId: string, userId: string): AppAlert[] {
  return rows.filter((row) => row.household_id === householdId && row.recipient_id === userId && row.actor_id !== userId).map((row) => ({
    id: `chart-restart:${row.id}`, type: "planner", title: "Chore chart restarted",
    message: `${row.actor_name} restarted the chore chart and reset approvals. Review your preferences and approve the new chart.`,
    createdAt: row.created_at, readAt: row.read_at ?? undefined,
    recipientId: userId, relatedEntityId: row.chart_id, relatedEntityType: "chore-chart",
    deduplicationKey: `chart-restart:${householdId}:${userId}:${row.id}`, severity: "info",
  }));
}

/** Server read receipts merge without duplicating events or making read alerts unread. */
export function mergeChartRestartAlerts(current: AppAlert[], incoming: AppAlert[]): AppAlert[] {
  const byKey = new Map(current.map((alert) => [alert.deduplicationKey, alert]));
  let changed = false;
  const additions: AppAlert[] = [];
  for (const alert of incoming) {
    const existing = byKey.get(alert.deduplicationKey);
    if (!existing) { additions.push(alert); byKey.set(alert.deduplicationKey, alert); changed = true; }
    else if (!existing.readAt && alert.readAt) { byKey.set(alert.deduplicationKey, { ...existing, readAt: alert.readAt }); changed = true; }
  }
  return changed ? [...additions, ...current.map((alert) => byKey.get(alert.deduplicationKey)!)] : current;
}
