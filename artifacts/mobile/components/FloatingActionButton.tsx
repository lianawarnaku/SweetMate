import { Feather } from "@expo/vector-icons";
import React, { useRef } from "react";
import { StyleSheet } from "react-native";

import { GlassControlSurface } from "@/components/GlassControlSurface";
import { SmoothPressable } from "@/components/SmoothPressable";
import { useTheme } from "@/constants/colors";

import { useTabBarLayout } from "@/hooks/useTabBarLayout";
const FAB_SIZE = 56;
const FAB_TAB_GAP = 12;
const FAB_CONTENT_GAP = 16;

export function useFloatingActionMetrics() {
  const { tabBarInset } = useTabBarLayout();
  const bottom = tabBarInset + FAB_TAB_GAP;

  return {
    bottom,
    scrollBottomPadding: bottom + FAB_SIZE + FAB_CONTENT_GAP,
  };
}

export function FloatingActionButton({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  icon = "plus",
}: {
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const colors = useTheme();
  const { bottom } = useFloatingActionMetrics();
  const pressLocked = useRef(false);

  return (
    <SmoothPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint ?? `Opens the ${accessibilityLabel.toLowerCase()} form`}
      containerStyle={[styles.container, { bottom }]}
      style={styles.button}
      onPress={() => {
        if (pressLocked.current) return;
        pressLocked.current = true;
        // Schedule unlocking before invoking consumer code: an exception must
        // not permanently turn every subsequent press into a no-op.
        setTimeout(() => {
          pressLocked.current = false;
        }, 450);
        onPress();
      }}
    >
      <GlassControlSurface borderless pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: FAB_SIZE / 2 }]} />
      <Feather name={icon} size={25} color={colors.foreground} />
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
    borderWidth: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
