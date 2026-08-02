// Google Calendar integration via @replit/connectors-sdk
import { Router } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  buildChoreCalendarEvent,
  type ChoreCalendarInput,
} from "../lib/choreCalendarEvent";

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
    const connectors = new ReplitConnectors();
    const event = buildChoreCalendarEvent(input as ChoreCalendarInput);

    const response = await connectors.proxy(
      "google-calendar",
      "/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      // A deterministic event ID makes concurrent taps and network retries
      // converge on the same Google event. Conflict means it already exists.
      if (response.status === 409) {
        res.json({ success: true, alreadyAdded: true, eventId: event.id });
        return;
      }
      await response.text(); // drain without logging provider/auth details
      const reconnect = response.status === 401 || response.status === 403;
      req.log.warn({ status: response.status }, "Google Calendar request rejected");
      res.status(reconnect ? 401 : 502).json({
        code: reconnect ? "GOOGLE_RECONNECT_REQUIRED" : "GOOGLE_CALENDAR_ERROR",
        error: reconnect
          ? "Connect Google Calendar again, then retry this chore."
          : "Google Calendar could not create the event. Please try again.",
      });
      return;
    }

    const created = await response.json() as { id: string; htmlLink?: string };
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
    req.log.error({ errorName: err instanceof Error ? err.name : "unknown" }, "Calendar connector failed");
    res.status(503).json({
      code: "CONNECTOR_UNAVAILABLE",
      error: "Google Calendar is unavailable right now. Please try again.",
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
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy(
      "google-calendar",
      "/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          items: [{ id: "primary" }],
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      req.log.error({ status: response.status, body: errBody }, "FreeBusy API error");
      res.status(502).json({ error: "Google Calendar API error", detail: errBody });
      return;
    }

    const data = (await response.json()) as {
      calendars: { primary: { busy: Array<{ start: string; end: string }> } };
    };

    const busySlots = data.calendars?.primary?.busy ?? [];
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
    req.log.error({ err }, "Failed to fetch availability");
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

export default router;
