import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { parseRandomTasksSnapshot, type RandomTask, type RandomTaskInput, type RandomTasksSnapshot } from "@/lib/randomTasks";
import type { ChoreRow } from "@/lib/choreRow";

const EMPTY_TASKS: RandomTask[] = [];

/** Shared server-owned tasks; no optimistic random draws or local claim timers. */
export function useRandomTasks(householdId: string | null, userId: string | null, onChores: (rows: ChoreRow[], householdId: string) => void) {
  const [snapshot, setSnapshot] = useState<RandomTasksSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [offset, setOffset] = useState(0);
  const scope = `${householdId ?? ""}:${userId ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const onChoresRef = useRef(onChores);
  onChoresRef.current = onChores;
  const pending = useRef<{ scope: string; promise: Promise<{ review: RandomTasksSnapshot; offset: number }> } | null>(null);
  const refresh = useCallback(async () => {
    if (!householdId || !userId) throw new Error("Select a household to use random tasks.");
    const request = { scope, promise: (async () => {
      const began = Date.now();
      const { data, error } = await supabase.rpc("get_household_random_tasks", { target_household_id: householdId });
      if (error) throw error;
      const review = parseRandomTasksSnapshot(data, householdId);
      return { review, offset: Date.parse(review.serverNow) - (began + Date.now()) / 2 };
    })() };
    pending.current = request;
    setLoading(true);
    setError(null);
    let latest = request;
    try {
      let result = await latest.promise;
      while (pending.current?.scope === scope && pending.current !== latest) { latest = pending.current; result = await latest.promise; }
      if (currentScope.current !== scope) throw new Error("The household changed. Reopen Random Task.");
      setSnapshot(result.review);
      setOffset(result.offset);
      setClock(Date.now());
      onChoresRef.current(result.review.chores, householdId);
      return result.review;
    } catch (failure) {
      if (currentScope.current === scope && pending.current === latest) setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Random tasks could not sync. Try again.");
      throw failure;
    } finally {
      if (currentScope.current === scope && pending.current === latest) setLoading(false);
    }
  }, [householdId, userId, scope]);

  useEffect(() => {
    if (!householdId || !userId) return;
    let active = true;
    const reload = () => { if (active) void refresh().catch(() => {}); };
    reload();
    const channel = supabase.channel(`random-tasks:${scope}`);
    for (const table of ["household_random_tasks", "chores"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` }, reload);
    }
    channel.subscribe((status) => { if (status === "SUBSCRIBED") reload(); });
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") reload(); });
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", reload);
    // Polling repairs missed Realtime events after reconnects. The server is
    // still responsible for assignments when every client is offline.
    const poll = setInterval(reload, 60_000);
    return () => {
      active = false;
      clearInterval(poll);
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", reload);
      void supabase.removeChannel(channel);
    };
  }, [householdId, userId, scope, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const review = snapshot?.householdId === householdId ? snapshot : null;
  useEffect(() => {
    const deadlines = review?.tasks.flatMap((task) => !task.assignedAt && task.claimDeadline ? [Date.parse(task.claimDeadline)] : []) ?? [];
    if (!deadlines.length) return;
    const untilDeadline = Math.min(...deadlines) - (Date.now() + offset);
    const delay = untilDeadline <= 0 ? 60_000 : Math.max(100, untilDeadline + 25);
    const timer = setTimeout(() => { void refresh().catch(() => {}); }, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [review, offset, refresh]);

  const create = useCallback(async (input: RandomTaskInput) => {
    if (!householdId || !userId) throw new Error("Select a household to add a random task.");
    const { error } = await supabase.rpc("create_household_random_task", { target_household_id: householdId, task_id: input.id, task_title: input.title.trim(), task_mode: input.mode });
    if (error) throw error;
    if (currentScope.current !== scope) throw new Error("Your task was saved in the previous household.");
    await refresh();
  }, [householdId, userId, scope, refresh]);
  const claim = useCallback(async (taskId: string) => {
    if (!householdId || !userId) throw new Error("Select a household to claim a task.");
    const { error } = await supabase.rpc("claim_household_random_task", { target_household_id: householdId, task_id: taskId });
    if (error) { void refresh().catch(() => {}); throw error; }
    if (currentScope.current !== scope) throw new Error("The household changed. Reopen Random Task.");
    await refresh();
  }, [householdId, userId, scope, refresh]);
  return { tasks: review?.tasks ?? EMPTY_TASKS, ready: review !== null, loading: Boolean(householdId && loading), error: householdId ? error : null,
    now: clock + offset, refresh, create, claim };
}
