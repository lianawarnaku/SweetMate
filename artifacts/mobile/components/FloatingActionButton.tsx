import { Feather } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SmoothPressable } from "@/components/SmoothPressable";
import { useTheme } from "@/constants/colors";

const TAB_BAR_HEIGHT = 68;
const TAB_BAR_WEB_BOTTOM = 12;
const TAB_BAR_NATIVE_MIN_BOTTOM = 8;
const FAB_SIZE = 56;
const FAB_TAB_GAP = 12;
const FAB_CONTENT_GAP = 16;

export function useFloatingActionMetrics() {
  const insets = useSafeAreaInsets();
  const tabBarBottom = Platform.OS === "web"
    ? TAB_BAR_WEB_BOTTOM
    : Math.max(insets.bottom, TAB_BAR_NATIVE_MIN_BOTTOM);
  const bottom = tabBarBottom + TAB_BAR_HEIGHT + FAB_TAB_GAP;

  return {
    bottom,
    scrollBottomPadding: bottom + FAB_SIZE + FAB_CONTENT_GAP,
  };
}

export function FloatingActionButton({
  onPress,
  accessibilityLabel,
  icon = "plus",
}: {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const colors = useTheme();
  const { bottom } = useFloatingActionMetrics();
  const pressLocked = useRef(false);

  return (
    <SmoothPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      containerStyle={[styles.container, { bottom }]}
      style={[styles.button, { backgroundColor: colors.action, borderColor: colors.primary }]}
      onPress={() => {
        if (pressLocked.current) return;
        pressLocked.current = true;
        onPress();
        setTimeout(() => {
          pressLocked.current = false;
        }, 450);
      }}
    >
      <Feather name={icon} size={25} color={colors.actionForeground} />
    </SmoothPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 20,
    width: FAB_SIZE,
    height: FAB_SIZE,
    zIndex: 20,
    elevation: 12,
  },
  button: {
    borderWidth: 1,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
});
