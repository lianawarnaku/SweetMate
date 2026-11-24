import { useCallback, useId, useState } from "react";
import { AppState, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAppContextSelector } from "@/context/AppContext";
import { householdChoreChartComplete, householdPlanningNeedsAttention, resolveHouseholdChartStatus, type HouseholdChartVerification } from "@/lib/householdPlanningStatus";
import { supabase } from "@/lib/supabase";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

export function useHouseholdPlanningStatus() {
  const { householdId, householdComplete, homeProfile, householdSetupDataReady, currentProposedChart, chartApprovals, roommates } = useAppContextSelector((context) => ({
    householdId: context.householdId, householdComplete: context.householdComplete,
    homeProfile: context.homeProfile, householdSetupDataReady: context.householdSetupDataReady,
    currentProposedChart: context.currentProposedChart, chartApprovals: context.chartApprovals, roommates: context.roommates,
  }));
  const subscriptionId = useId();
  const latestChart = currentProposedChart?.householdId === householdId ? currentProposedChart : null;
  const observationKey = JSON.stringify([householdId, latestChart?.id, latestChart?.status, latestChart?.appliedAt,
    roommates.map((member) => member.id).sort(), chartApprovals.map((approval) => [approval.proposedChartId, approval.memberId, approval.approved]).sort()]);
  const [verification, setVerification] = useState<HouseholdChartVerification>({ householdId: null, observationKey: "", ready: false, complete: false, error: false });

  useFocusEffect(useCallback(() => {
    if (!householdId) return;
    let active = true;
    let requestVersion = 0;
    const refresh = async () => {
      if (!active) return;
      const version = ++requestVersion;
      setVerification({ householdId, observationKey, ready: false, complete: false, error: false });
      try {
        const { data, error } = await supabase.rpc("get_household_chart_completion", { target_household_id: householdId });
        if (!active || version !== requestVersion) return;
        if (error) throw error;
        if (!data || typeof data.complete !== "boolean") throw new Error("The household chart status is unavailable.");
        setVerification({ householdId, observationKey, ready: true,
          complete: data.complete && householdChoreChartComplete(data.status ? { status: data.status, appliedAt: data.appliedAt } : null), error: false });
      } catch (error) {
        if (!active || version !== requestVersion) return;
        reportRuntimeError("verify latest household chart completion", error, { householdId });
        setVerification({ householdId, observationKey, ready: false, complete: false, error: true });
      }
    };
    void refresh();
    const channel = supabase.channel(`planning-completion:${householdId}:${subscriptionId}`);
    for (const table of ["proposed_charts", "proposed_chart_approvals", "household_members"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` }, () => { void refresh(); });
    }
    // Recheck after subscribing to cover changes between the initial read and
    // registration, including another roommate sending a new proposal.
    channel.subscribe((state) => { if (state === "SUBSCRIBED") void refresh(); });
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    const onWindowFocus = () => { void refresh(); };
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", onWindowFocus);
    return () => {
      active = false;
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", onWindowFocus);
      void supabase.removeChannel(channel);
    };
  }, [householdId, observationKey, subscriptionId]));

  const chartStatus = resolveHouseholdChartStatus({ householdId, observationKey, latestChart, verification });
  const setupComplete = householdComplete && Boolean(homeProfile);
  return {
    setupComplete, setupReady: householdSetupDataReady, chartStatus,
    needsAttention: Boolean(householdId) && householdPlanningNeedsAttention({ setupReady: householdSetupDataReady, setupComplete, chartReady: chartStatus.ready, chartComplete: chartStatus.complete }),
  };
}
