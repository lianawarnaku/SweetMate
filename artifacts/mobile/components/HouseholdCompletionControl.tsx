import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { useAppPopup } from "@/components/AppPopupProvider";
import { SmoothPressable } from "@/components/SmoothPressable";

export function HouseholdCompletionControl() {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const { householdComplete, setHouseholdComplete, roommates } = useAppContext();
  const hasRoommates = roommates.length >= 2;

  const completeHousehold = () => {
    if (hasRoommates) {
      setHouseholdComplete(true);
      return;
    }

    showPopup({
      title: "Warning",
      message: "Warning: You have no roomates added.",
      icon: "alert-triangle",
      actions: [
        { label: "Cancel" },
        {
          label: "Complete anyway",
          primary: true,
          onPress: () => setHouseholdComplete(true),
        },
      ],
    });
  };

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
          {householdComplete ? "Household setup complete" : "Ready to finish setup?"}
        </Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {householdComplete
            ? "The chore-chart generator is unlocked."
            : hasRoommates
              ? `${roommates.length} members added. Confirm that everyone is here.`
              : "You can finish now and add Sweetmates later."}
        </Text>
      </View>
      {!householdComplete && (
        <SmoothPressable
          accessibilityRole="button"
          accessibilityHint="Unlocks household chore-chart planning"
          accessibilityLabel="Mark household setup complete"
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
            Mark household complete
          </Text>
        </SmoothPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 17, marginTop: 2 },
  action: {
    width: "100%",
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionSlot: { width: "100%" },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
