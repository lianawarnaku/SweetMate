import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { useAppPopup } from "@/components/AppPopupProvider";
import { supabase } from "@/lib/supabase";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";
import { SmoothPressable } from "@/components/SmoothPressable";

export function HouseholdCompletionControl({ compact = false, chartStatus }: {
  compact?: boolean;
  chartStatus?: { ready: boolean; complete: boolean; error?: boolean };
}) {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const { householdComplete, setHouseholdComplete, roommates, householdId, refreshMembers, homeProfile, householdSetupDataReady } = useAppContext();
  const [checkingMembers, setCheckingMembers] = useState(false);
  const checkingRef = useRef(false);
  const activeHouseholdRef = useRef(householdId);
  activeHouseholdRef.current = householdId;
  const hasRoommates = roommates.length >= 2;

  const completeHousehold = async () => {
    if (!householdId || checkingRef.current) return;
    if (!homeProfile) {
      router.push(`/sweet-setup?resume=1&household=${householdId}` as never);
      return;
    }
    const targetHouseholdId = householdId;
    checkingRef.current = true;
    setCheckingMembers(true);
    try {
      // Realtime/local state may still contain only the host immediately after
      // someone joins. Confirm against the active roster before warning.
      const { data, error } = await supabase
        .from("household_members")
        .select("user_id")
        .eq("household_id", targetHouseholdId)
        .eq("status", "active");
      if (activeHouseholdRef.current !== targetHouseholdId) return;
      if (error) throw error;
      if (!data?.length) throw new Error("The active household roster is unavailable.");
      void refreshMembers();
      if (new Set(data.map((member) => member.user_id)).size >= 2) {
        await setHouseholdComplete(true);
        return;
      }
      showPopup({
        title: "No roommates added yet",
        message: "You are the only active member of this household. You can finish setup now and add roommates later.",
        icon: "alert-triangle",
        actions: [
          { label: "Cancel" },
          {
            label: "Complete anyway",
            primary: true,
            onPress: async () => {
              if (activeHouseholdRef.current !== targetHouseholdId) return;
              try { await setHouseholdComplete(true); }
              catch { showPopup({ title: "Couldn't finish setup", message: "Your setup wasn't saved. Please check your connection and try again.", actions: [{ label: "OK" }] }); }
            },
          },
        ],
      });
    } catch (error) {
      if (activeHouseholdRef.current !== targetHouseholdId) return;
      reportRuntimeError("verify household members before completing setup", error, { householdId: targetHouseholdId });
      showPopup({
        title: "Couldn't finish household setup",
        message: "Please check your connection and try again.",
        icon: "alert-triangle",
        actions: [{ label: "OK" }],
      });
    } finally {
      checkingRef.current = false;
      setCheckingMembers(false);
    }
  };

  if (compact) {
    const complete = householdComplete && Boolean(homeProfile);
    const disabled = checkingMembers || !householdId || !householdSetupDataReady;
    const setupStatusLabel = !householdSetupDataReady ? "Checking setup" : complete ? "Setup complete" : "Setup incomplete";
    return (
      <View style={styles.statusStack}>
        <SmoothPressable
          accessibilityRole="button"
          accessibilityLabel={householdSetupDataReady ? complete ? "Household setup complete" : "Household setup incomplete" : "Checking household setup"}
          accessibilityHint="Asks whether to reopen your saved household setup for editing"
          disabled={disabled}
          onPress={() => {
            const targetHouseholdId = householdId;
            showPopup({
              title: "Edit household setup?",
              message: "Review and change your home type, shared items, and chore settings. Your current settings will be loaded for you to edit.",
              icon: "home",
              actions: [
                { label: "Cancel" },
                { label: "Edit setup", primary: true, onPress: () => {
                  if (activeHouseholdRef.current !== targetHouseholdId) return;
                  router.push(`/sweet-setup?resume=1&household=${targetHouseholdId}` as never);
                } },
              ],
            });
          }}
          style={[styles.statusLine, styles.statusButton]}
        >
          <Text style={[styles.compactText, { color: householdSetupDataReady && !complete ? colors.destructive : colors.mutedForeground }]}>
            {setupStatusLabel}
          </Text>
          <Feather accessible={false} name={complete && householdSetupDataReady ? "check-square" : "square"} size={14} color={householdSetupDataReady && !complete ? colors.destructive : colors.mutedForeground} />
        </SmoothPressable>
        {chartStatus && <SmoothPressable
          accessibilityRole="button"
          accessibilityLabel={chartStatus.ready ? chartStatus.complete ? "Chore chart complete" : "Chore chart incomplete" : chartStatus.error ? "Chore chart status unavailable" : "Checking chore chart"}
          accessibilityHint="Opens the Chore Chart creator"
          disabled={!householdId}
          onPress={() => router.push("/planning?type=chore-chart" as never)}
          style={[styles.statusLine, styles.statusButton]}
        >
          <Text style={[styles.compactText, { color: chartStatus.ready && !chartStatus.complete ? colors.destructive : colors.mutedForeground }]}>
            {chartStatus.ready ? chartStatus.complete ? "Chore chart complete" : "Chore chart incomplete" : chartStatus.error ? "Chart status unavailable" : "Checking chore chart"}
          </Text>
          <Feather accessible={false} name={chartStatus.ready && chartStatus.complete ? "check-square" : "square"} size={14} color={chartStatus.ready && !chartStatus.complete ? colors.destructive : colors.mutedForeground} />
        </SmoothPressable>}
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: colors.primary + "18" }]}>
        <Feather
          name={householdComplete ? "check-circle" : "users"}
          size={20}
          color={householdComplete ? colors.success : colors.primary}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {!homeProfile ? "Finish your home details" : householdComplete ? "Household setup complete" : "Ready to finish setup?"}
        </Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {!householdSetupDataReady ? "Loading household setup…" : !homeProfile ? "Your roommates are saved. Finish your home type and shared items to unlock planning." : householdComplete
            ? "The chore-chart generator is unlocked."
            : hasRoommates
              ? `${roommates.length} members added. Confirm that everyone is here.`
              : "You can finish now and add Sweetmates later."}
        </Text>
      </View>
      {(!householdComplete || !homeProfile) && (
        <SmoothPressable
          accessibilityRole="button"
          accessibilityHint="Unlocks household chore-chart planning"
          accessibilityLabel="Mark household setup complete"
          disabled={checkingMembers || !householdId || !householdSetupDataReady}
          accessibilityState={{ busy: checkingMembers, disabled: checkingMembers || !householdId || !householdSetupDataReady }}
          onPress={completeHousehold}
          containerStyle={styles.actionSlot}
          style={[
            styles.action,
            {
              backgroundColor: colors.action,
              borderColor: colors.primary,
            },
          ]}
        >
          <Text
            style={[
              styles.actionText,
              { color: colors.actionForeground },
            ]}
          >
            {checkingMembers ? "Saving setup…" : !homeProfile ? "Finish home details" : "Mark household complete"}
          </Text>
        </SmoothPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statusStack: { gap: 6, alignItems: "flex-start" },
  statusLine: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 },
  statusButton: { minHeight: 44 },
  compactText: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 14, flexShrink: 0 },
  card: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 180 },
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
  hint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, lineHeight: 17, marginTop: 2 },
  action: {
    width: "100%",
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionSlot: { width: "100%" },
  actionText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },
});
