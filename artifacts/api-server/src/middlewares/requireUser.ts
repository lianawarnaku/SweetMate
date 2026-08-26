import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Verifies the caller's Supabase session (sent as `Authorization: Bearer
 * <access_token>`) and attaches req.userId. Every route that acts on behalf
 * of a specific user's own data (e.g. their Google Calendar connection)
 * must run behind this — without it, nothing in this API server verifies
 * caller identity at all.
 */
export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ code: "UNAUTHENTICATED", error: "Sign in required." });
    return;
  }
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ code: "UNAUTHENTICATED", error: "Your session has expired. Please sign in again." });
    return;
  }
  req.userId = data.user.id;
  next();
}
