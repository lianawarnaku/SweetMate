import { Router } from "express";
import { requireUser } from "../middlewares/requireUser";
import {
  deleteGoogleCalendarConnection,
  hasGoogleCalendarConnection,
  storeGoogleCalendarConnection,
} from "../lib/googleCalendarUser";
import { GoogleCalendarError } from "../lib/googleCalendar";

const router = Router();

// GET /api/calendar/connection
// Reports whether the authenticated user has a Google Calendar connection.
router.get("/calendar/connection", requireUser, async (req, res) => {
  try {
    const connected = await hasGoogleCalendarConnection(req.userId!);
    res.json({ connected });
  } catch (err) {
    req.log.error({ err }, "Failed to check Google Calendar connection");
    res.status(500).json({ code: "GOOGLE_CALENDAR_ERROR", error: "Could not check your Google Calendar connection." });
  }
});

// POST /api/calendar/connect
// Body: { refreshToken, scope? } — the Google refresh token the mobile app
// already obtained from Supabase's own OAuth flow (session.provider_refresh_token
// after requesting the calendar.events scope). Stored per-user so
// add-chore can act on this specific person's calendar.
router.post("/calendar/connect", requireUser, async (req, res) => {
  const { refreshToken, scope } = req.body as { refreshToken?: string; scope?: string };
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    res.status(400).json({
      code: "INVALID_CONNECTION",
      error: "Google did not grant offline calendar access. Try again and allow the calendar permission.",
    });
    return;
  }
  try {
    await storeGoogleCalendarConnection(req.userId!, refreshToken.trim(), scope);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      req.log.error({ err, code: err.code }, "Failed to store Google Calendar connection");
      res.status(err.httpStatus).json({ code: err.code, error: err.userMessage });
      return;
    }
    req.log.error({ err }, "Failed to store Google Calendar connection unexpectedly");
    res.status(503).json({ code: "GOOGLE_CALENDAR_ERROR", error: "Could not save your Google Calendar connection." });
  }
});

// POST /api/calendar/disconnect
router.post("/calendar/disconnect", requireUser, async (req, res) => {
  try {
    await deleteGoogleCalendarConnection(req.userId!);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      req.log.error({ err, code: err.code }, "Failed to disconnect Google Calendar");
      res.status(err.httpStatus).json({ code: err.code, error: err.userMessage });
      return;
    }
    req.log.error({ err }, "Failed to disconnect Google Calendar unexpectedly");
    res.status(503).json({ code: "GOOGLE_CALENDAR_ERROR", error: "Could not disconnect Google Calendar." });
  }
});

export default router;
