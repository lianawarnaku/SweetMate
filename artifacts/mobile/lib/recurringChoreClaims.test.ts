import type { Chore } from "../context/AppContext.tsx";
import { recurringChoreClaims } from "./recurringChoreClaims.ts";
import { materializeRecurringOccurrences } from "./choreOccurrences.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const occurrence: Chore = {
  id: "occurrence:home:series:2026-07-27",
  householdId: "home",
  title: "Clean",
  assignedTo: "member",
  dueDate: "2026-07-28T03:59:00.000Z",
  scheduledDate: "2026-07-27",
  completed: false,
  points: 10,
  category: "cleaning",
  recurring: "weekly",
  recurrenceSeriesId: "series",
};
const claims = recurringChoreClaims(
  [occurrence, { ...occurrence }, { ...occurrence, id: "one-off", recurring: undefined }],
  "home",
);
assert(claims.length === 1, "claim batching must deduplicate occurrence identities");
assert(
  claims[0].scheduled_date === "2026-07-27" &&
    claims[0].occurrence_id === occurrence.id,
  "claim batching must preserve the stable scheduled date and occurrence ID",
);

const dormantRoot: Chore = {
  ...occurrence,
  id: "dormant-series",
  recurrenceSeriesId: "dormant-series",
  scheduledDate: "2026-01-01",
  dueDate: "2026-01-01T12:00:00.000Z",
  initialDueDate: "2026-01-01T12:00:00.000Z",
  recurring: "daily",
  occurrenceIndex: 0,
};
const activeDeviceState = materializeRecurringOccurrences(
  [dormantRoot],
  new Date(2026, 7, 26, 12),
  "2026-08-26T12:00:00.000Z",
);
const dormantDeviceAfterHydration = materializeRecurringOccurrences(
  activeDeviceState,
  new Date(2026, 7, 26, 12),
  "2026-08-26T12:05:00.000Z",
);
assert(
  dormantDeviceAfterHydration === activeDeviceState,
  "a dormant device that hydrates the active device's household state must not rematerialize occurrences",
);
const activeClaims = recurringChoreClaims(activeDeviceState, "home");
assert(
  activeClaims.length === new Set(
    activeClaims.map((claim) => `${claim.recurrence_series_id}:${claim.scheduled_date}`),
  ).size,
  "a dormant catch-up must produce one database claim per series date",
);

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/202607300006_recurring_chore_occurrence_keys.sql",
  ),
  "utf8",
);
assert(
  migration.includes(
    "primary key (household_id, recurrence_series_id, scheduled_date)",
  ) &&
    migration.includes("unique (household_id, occurrence_id)"),
  "database constraints must reject duplicate scheduled occurrences and IDs",
);
assert(
  migration.includes("public.is_household_member(household_id)") &&
    migration.includes("enable row level security"),
  "occurrence claims must remain household-isolated under RLS",
);
