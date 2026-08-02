import { createHash } from "node:crypto";

export type ChoreCalendarInput = {
  choreId: string;
  title: string;
  dueDate: string;
  category?: string;
  description?: string;
  assignee?: string;
  household?: string;
  points?: number;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function calendarDate(value: string): string | null {
  const candidate = value.slice(0, 10);
  if (!DATE_ONLY.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? candidate
    : null;
}

export function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export function googleEventId(choreId: string): string {
  // Google accepts base32hex characters (0-9, a-v). A hex digest is therefore
  // a valid deterministic event ID and makes repeated inserts idempotent.
  return createHash("sha256")
    .update(`sweetmate:chore-occurrence:${choreId}`)
    .digest("hex");
}

export function buildChoreCalendarEvent(input: ChoreCalendarInput) {
  const date = calendarDate(input.dueDate);
  if (!date) throw new Error("INVALID_DUE_DATE");

  return {
    id: googleEventId(input.choreId),
    summary: `🏠 ${input.title.trim()}`,
    description: [
      "Added from SweetMate",
      input.assignee ? `Assigned to: ${input.assignee}` : null,
      input.household ? `Sweet: ${input.household}` : null,
      input.category ? `Category: ${input.category}` : null,
      input.description?.trim() || null,
      input.points ? `Points: +${input.points}` : null,
    ].filter(Boolean).join("\n"),
    start: { date },
    // Google all-day event end dates are exclusive.
    end: { date: nextCalendarDate(date) },
    extendedProperties: {
      private: { sweetmateChoreOccurrenceId: input.choreId },
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 480 }],
    },
  };
}
