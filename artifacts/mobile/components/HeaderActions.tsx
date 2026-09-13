import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

import { SmoothPressable } from "@/components/SmoothPressable";
import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";

export function HeaderActions() {
  const colors = useTheme();
  const { currentProposedChart, currentUserId, nudges, appAlerts } =
    useAppContextSelector((context) => ({
      currentProposedChart: context.currentProposedChart,
      currentUserId: context.currentUserId,
      nudges: context.nudges,
      appAlerts: context.appAlerts,
    }));
  const hasPendingAlert =
    currentProposedChart?.status === "pending" ||
    nudges.some(
      (nudge) => nudge.toRoommateId === currentUserId && !nudge.seen,
    ) ||
    appAlerts.some((alert) => !alert.readAt);

  return (
    <View style={styles.cluster}>
      <SmoothPressable
        accessibilityRole="button"
        accessibilityLabel={hasPendingAlert ? "Open household alerts, unread alerts available" : "Open household alerts"}
        accessibilityHint="Shows household reminders and updates"
        onPress={() => router.push("/alerts")}
        containerStyle={styles.hitArea}
        style={[styles.button, { backgroundColor: colors.muted }]}
      >
        <Feather name="bell" size={20} color={colors.foreground} />
        {hasPendingAlert && (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: colors.destructive,
                borderColor: colors.muted,
              },
            ]}
          />
        )}
      </SmoothPressable>
      <SmoothPressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        accessibilityHint="Opens appearance, accessibility, and account settings"
        onPress={() => router.push("/settings")}
        containerStyle={styles.hitArea}
        style={[styles.button, { backgroundColor: colors.muted }]}
      >
        <Feather name="settings" size={20} color={colors.foreground} />
      </SmoothPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hitArea: {
    width: 44,
    height: 44,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: 9,
    top: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
});
