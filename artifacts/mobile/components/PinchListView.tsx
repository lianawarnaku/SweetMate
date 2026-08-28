import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";

import { useTheme } from "@/constants/colors";
import { Surface } from "@/components/Surface";
import { resolvePinchView } from "@/lib/pinchListView";

const preferenceKey = (userId: string, screen: string) =>
  `sweetmate:pinch-list-view:v1:${userId}:${screen}`;
const coachKey = (userId: string, screen: string) =>
  `sweetmate:pinch-list-coach:v1:${userId}:${screen}`;

export function usePinchListView(userId: string, screen: "home" | "group") {
  const [listView, setListView] = useState(false);
  const [showCoach, setShowCoach] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    Promise.all([
      AsyncStorage.getItem(preferenceKey(userId, screen)),
      AsyncStorage.getItem(coachKey(userId, screen)),
    ])
      .then(([storedView, coachSeen]) => {
        if (!active) return;
        setListView(storedView === "list");
        setShowCoach(coachSeen !== "seen");
      })
      .catch(() => {
        if (active) setShowCoach(true);
      });
    return () => {
      active = false;
    };
  }, [screen, userId]);

  const selectView = (nextListView: boolean) => {
    setListView(nextListView);
    void AsyncStorage.setItem(
      preferenceKey(userId, screen),
      nextListView ? "list" : "timeline",
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onEnd(({ scale }) => {
          const next = resolvePinchView(scale, listView ? "list" : "dashboard");
          if (next !== (listView ? "list" : "dashboard")) {
            selectView(next === "list");
          }
        })
        .runOnJS(true),
    [listView, screen, userId],
  );

  const dismissCoach = () => {
    setShowCoach(false);
    void AsyncStorage.setItem(coachKey(userId, screen), "seen");
  };

  return { listView, pinchGesture, showCoach, dismissCoach };
}

export function PinchListViewCoach({
  visible,
  onDismiss,
  top,
}: {
  visible: boolean;
  onDismiss: () => void;
  top: number;
}) {
  const colors = useTheme();
  if (!visible) return null;

  return (
    <Surface
      style={[
        styles.coach,
        { top, borderColor: colors.border },
      ]}
    >
      <View style={[styles.gestureIcon, { borderColor: colors.border }]}>
        <Feather name="minimize-2" size={24} color={colors.foreground} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>Pinch for list view</Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          Pinch with two fingers to switch between dashboard and list views.
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        style={[styles.close, { backgroundColor: colors.muted, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Dismiss pinch gesture tip"
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Feather name="x" size={19} color={colors.foreground} />
      </TouchableOpacity>
    </Surface>
  );
}

const styles = StyleSheet.create({
  coach: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 30,
    minHeight: 112,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    paddingRight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  gestureIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  message: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  close: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
