import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import type { BusyActivity, PersonalScheduleItem, SchedulePreferences, ScheduleSources, TaskScheduleUpdate } from "@/lib/personalSchedule";

const EMPTY: PersonalScheduleItem[] = [];
export async function googleScheduleRequest(path: string, body?: unknown) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to sync your Google schedule.");
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/google-schedule/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error ?? "Google schedule sync is unavailable. Try again shortly.");
  return value;
}
export function usePersonalSchedule(userId: string | null, householdId: string | null, showActivity: boolean) {
  const [state, setState] = useState<{ userId: string; householdId: string | null; prefs: SchedulePreferences | null; items: PersonalScheduleItem[]; shareBusy: boolean } | null>(null);
  const [busyState, setBusyState] = useState<{ userId: string; householdId: string; rows: BusyActivity[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scope = `${userId}:${householdId}`;
  useEffect(() => { setLoading(false); setError(null); }, [scope]);
  const current = useRef(scope); current.current = scope;
  const syncPending = useRef<string | null>(null);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const request = ++version.current;
    const [prefs, items, sharing] = await Promise.all([
      supabase.from("personal_schedule_preferences").select("user_id,enabled,calendar_ids,task_list_ids,timezone,synced_at,sync_error").eq("user_id", userId).maybeSingle(),
      supabase.from("personal_schedule_items").select("*").eq("user_id", userId),
      householdId ? supabase.from("member_schedule_sharing").select("enabled").eq("user_id", userId).eq("household_id", householdId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (current.current !== scope || request !== version.current) return;
    const failure = prefs.error || items.error || sharing.error;
    if (failure) throw failure;
    const config = prefs.data as SchedulePreferences | null;
    setState({ userId, householdId, prefs: config, shareBusy: sharing.data?.enabled === true,
      items: ((items.data ?? []) as PersonalScheduleItem[]).filter((item) => item.user_id === userId && config?.enabled &&
        (item.source === "google-event" ? config.calendar_ids : config.task_list_ids).includes(item.resource_id)) });
  }, [userId, householdId, scope]);
  const sync = useCallback(async (day?: string) => {
    if (!userId || syncPending.current === scope) return;
    syncPending.current = scope; setLoading(true); setError(null);
    try { await googleScheduleRequest("sync", day ? { day } : {}); if (current.current === scope) await refresh(); }
    catch (failure) { if (current.current === scope) setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Your schedule could not sync."); throw failure; }
    finally { if (syncPending.current === scope) syncPending.current = null; if (current.current === scope) setLoading(false); }
  }, [userId, scope, refresh]);
  const enabled = state?.userId === userId && state.prefs?.enabled === true;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const reload = () => { if (active) void refresh().catch((failure) => { if (active) setError(failure.message ?? "Your schedule could not load."); }); };
    reload();
    const onFocus = () => { reload(); if (enabled) void sync().catch(() => {}); };
    const listener = AppState.addEventListener("change", (value) => { if (value === "active") onFocus(); });
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", onFocus);
    const poll = setInterval(onFocus, 60_000);
    return () => { active = false; clearInterval(poll); listener.remove(); if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", onFocus); };
  }, [userId, enabled, refresh, sync]);
  useEffect(() => { if (enabled) void sync().catch(() => {}); }, [enabled, sync]);
  useEffect(() => {
    if (!userId || !householdId || !showActivity) return;
    let active = true;
    const reload = async () => {
      const { data, error } = await supabase.rpc("get_household_schedule_activity", { target_household_id: householdId });
      if (active && !error) setBusyState({ userId, householdId, rows: data ?? [] });
    };
    void reload();
    const interval = setInterval(() => { void reload(); }, 20_000);
    const listener = AppState.addEventListener("change", (value) => { if (value === "active") void reload(); });
    return () => { active = false; clearInterval(interval); listener.remove(); };
  }, [householdId, userId, showActivity]);
  const configure = useCallback(async (calendars: string[], tasks: string[], timezone: string, enable: boolean) => {
    const { error } = await supabase.rpc("configure_personal_schedule", { calendar_ids: calendars, task_list_ids: tasks, schedule_timezone: timezone, enable_sync: enable });
    if (error) throw error;
    await refresh();
    if (enable) await sync();
  }, [refresh, sync]);
  const shareBusy = useCallback(async (enabled: boolean) => {
    if (!householdId) throw new Error("Select a household to share busy status.");
    const { error } = await supabase.rpc("set_schedule_busy_sharing", { target_household_id: householdId, share_busy: enabled });
    if (error) throw error;
    await refresh();
  }, [householdId, refresh]);
  const updateTask = useCallback(async (id: string, update: TaskScheduleUpdate) => {
    const { error } = await supabase.rpc("update_personal_schedule_task", { task_id: id, completed: update.completed ?? null,
      task_period: update.period ?? null, time_start: update.start ?? null, time_end: update.end ?? null, clear_time: update.clearTime ?? false });
    if (error) throw error;
    await refresh();
  }, [refresh]);
  const sources = useCallback(async (): Promise<ScheduleSources> => googleScheduleRequest("sources"), []);
  return { items: state?.userId === userId ? state.items : EMPTY, prefs: state?.userId === userId ? state.prefs : null,
    sharing: state?.userId === userId && state.householdId === householdId ? state.shareBusy : false,
    activity: showActivity && busyState?.householdId === householdId && busyState?.userId === userId ? busyState.rows : [],
    loading, error, ready: state?.userId === userId, refresh, sync, sources, configure, shareBusy, updateTask };
}
