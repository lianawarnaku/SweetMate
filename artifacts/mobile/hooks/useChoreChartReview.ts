import { useCallback, useId, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { parseChoreChartReviewSnapshot, type ChoreChartReviewSnapshot } from "@/lib/choreChartReview";

/** Approval screens read the shared review directly, including after restart. */
export function useChoreChartReview(householdId: string | null) {
  const [review, setReview] = useState<ChoreChartReviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const household = useRef(householdId);
  household.current = householdId;
  const pending = useRef<{ householdId: string; promise: Promise<ChoreChartReviewSnapshot> } | null>(null);
  const subscriptionId = useId();
  const refresh = useCallback(async () => {
    const target = householdId;
    if (!target) throw new Error("No household is selected.");
    const request = { householdId: target, promise: (async () => {
      const { data, error } = await supabase.rpc("get_household_chart_review", { target_household_id: target });
      if (error) throw error;
      return parseChoreChartReviewSnapshot(data, target);
    })() };
    pending.current = request;
    setLoading(true);
    setError(null);
    let latest = request;
    try {
      let result = await latest.promise;
      // If a restart/approval arrived during this read, all callers follow the
      // newest request instead of restoring the earlier response.
      while (pending.current?.householdId === target && pending.current !== latest) {
        latest = pending.current;
        result = await latest.promise;
      }
      if (household.current !== target) throw new Error("The active household changed. Reopen its chart.");
      setReview(result);
      return result;
    } catch (failure) {
      if (household.current === target && pending.current === latest) {
        setReview(null);
        setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Unable to load the current chore chart.");
      }
      throw failure;
    } finally {
      if (household.current === target && pending.current === latest) setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(useCallback(() => {
    if (!householdId) return;
    let active = true;
    const reload = () => { if (active) void refresh().catch(() => {}); };
    reload();
    const channel = supabase.channel(`chart-review:${householdId}:${subscriptionId}`);
    for (const table of ["proposed_charts", "proposed_chart_approvals"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` }, reload);
    }
    channel.subscribe((status) => { if (status === "SUBSCRIBED") reload(); });
    const appState = AppState.addEventListener("change", (status) => { if (status === "active") reload(); });
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", reload);
    return () => {
      active = false;
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", reload);
      void supabase.removeChannel(channel);
    };
  }, [householdId, refresh, subscriptionId]));
  return { review: review?.householdId === householdId ? review : null, loading: householdId ? loading : false, error: householdId ? error : null, refresh };
}
