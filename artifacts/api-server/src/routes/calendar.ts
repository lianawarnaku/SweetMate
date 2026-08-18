import { Router } from "express";
import {
  buildChoreCalendarEvent,
  type ChoreCalendarInput,
} from "../lib/choreCalendarEvent";
import {
  configuredCalendarId,
  googleCalendarRequest,
  GoogleCalendarError,
} from "../lib/googleCalendar";

const router = Router();

// POST /api/calendar/add-chore
// Body: { title, dueDate, category, points }
// Creates a Google Calendar event for a chore on its due date
router.post("/calendar/add-chore", async (req, res) => {
  const input = req.body as Partial<ChoreCalendarInput>;

  if (
    typeof input.choreId !== "string" ||
    !input.choreId.trim() ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    typeof input.dueDate !== "string"
  ) {
    res.status(400).json({
      code: "INVALID_CHORE",
      error: "A chore ID, title, and due date are required.",
    });
    return;
  }

  try {
    const event = buildChoreCalendarEvent(input as ChoreCalendarInput);
    const calendarId = encodeURIComponent(configuredCalendarId());
    const response = await googleCalendarRequest(
      `/calendars/${calendarId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      // A deterministic event ID makes concurrent taps and network retries
      // converge on the same Google event. Conflict means it already exists.
      if (response.status === 409) {
        res.json({ success: true, alreadyAdded: true, eventId: event.id });
        return;
      }
      throw new Error(
        `Unexpected Google Calendar response: ${response.status}`,
      );
    }

    const created = (await response.json()) as {
      id: string;
      htmlLink?: string;
    };
    res.json({
      success: true,
      alreadyAdded: false,
      eventId: created.id,
      link: created.htmlLink,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_DUE_DATE") {
      res.status(400).json({
        code: "INVALID_DUE_DATE",
        error: "This chore needs a valid due date before it can be added.",
      });
      return;
    }
    if (err instanceof GoogleCalendarError) {
      req.log.error(
        { err, code: err.code, diagnostic: err.diagnostic },
        "Google Calendar add failed",
      );
      res.status(err.httpStatus).json({
        code: err.code,
        error: err.userMessage,
        detail: err.diagnostic,
      });
      return;
    }
    req.log.error({ err }, "Google Calendar add failed unexpectedly");
    res.status(503).json({
      code: "GOOGLE_CALENDAR_ERROR",
      error:
        "Google Calendar failed unexpectedly. Please try again or contact support.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/calendar/availability?weekStart=YYYY-MM-DD
// Returns the current user's busy time slots for the week from Google Calendar
router.get("/calendar/availability", async (req, res) => {
  const weekStart = req.query.weekStart as string | undefined;
  if (!weekStart) {
    res.status(400).json({ error: "weekStart is required" });
    return;
  }

  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  try {
    const calendarId = configuredCalendarId();
    const response = await googleCalendarRequest("/freeBusy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calendarId }],
      }),
    });

    const data = (await response.json()) as {
      calendars: Record<
        string,
        { busy: Array<{ start: string; end: string }> }
      >;
    };

    const busySlots = data.calendars?.[calendarId]?.busy ?? [];
    const busyDays = new Set<string>();
    for (const slot of busySlots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      const d = new Date(slotStart);
      d.setHours(0, 0, 0, 0);
      while (d < slotEnd) {
        busyDays.add(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
    }

    res.json({ busyDays: [...busyDays], connected: true });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      req.log.error(
        { err, code: err.code, diagnostic: err.diagnostic },
        "Google Calendar availability failed",
      );
      res
        .status(err.httpStatus)
        .json({
          code: err.code,
          error: err.userMessage,
          detail: err.diagnostic,
        });
      return;
    }
    req.log.error({ err }, "Failed to fetch Google Calendar availability");
    res.status(500).json({
      code: "GOOGLE_CALENDAR_ERROR",
      error: "Google Calendar availability failed unexpectedly.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
