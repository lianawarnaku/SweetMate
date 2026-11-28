import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

import {
  FloatingActionButton,
  useFloatingActionMetrics,
} from "@/components/FloatingActionButton";
import { GlassControlSurface } from "@/components/GlassControlSurface";
import { SmoothPressable } from "@/components/SmoothPressable";
import { useTheme } from "@/constants/colors";

export type AddMenuOption = {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
};

const MINI_SIZE = 48;
const MINI_GAP = 12;
const FAB_SIZE = 56;

/** Floating + that expands into labelled quick-add shortcuts. */
export function AddMenuFab({ options }: { options: AddMenuOption[] }) {
  const colors = useTheme();
  const { bottom } = useFloatingActionMetrics();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <Pressable
          accessibilityLabel="Close add menu"
          accessibilityRole="button"
          style={styles.backdrop}
          onPress={() => setOpen(false)}
        />
      )}
      {open && (
        <View pointerEvents="box-none" style={[styles.stack, { bottom: bottom + FAB_SIZE + MINI_GAP }]}>
          {options.map((option, index) => (
            <Animated.View
              key={option.key}
              entering={FadeInDown.delay((options.length - 1 - index) * 40).duration(180)}
              exiting={FadeOut.duration(100)}
              style={styles.row}
            >
              <View style={[styles.label, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.labelText, { color: colors.foreground }]}>{option.label}</Text>
              </View>
              <SmoothPressable
                accessibilityLabel={`Add ${option.label.toLowerCase()}`}
                style={styles.mini}
                onPress={() => {
                  setOpen(false);
                  option.onPress();
                }}
              >
                <GlassControlSurface borderless pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: MINI_SIZE / 2 }]} />
                <Feather name={option.icon} size={20} color={colors.foreground} />
              </SmoothPressable>
            </Animated.View>
          ))}
        </View>
      )}
      <FloatingActionButton
        icon={open ? "x" : "plus"}
        accessibilityLabel={open ? "Close add menu" : "Add"}
        accessibilityHint={open ? "Hides the quick add options" : "Shows options for what to add"}
        onPress={() => setOpen((value) => !value)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill as object,
    backgroundColor: "rgba(0,0,0,0.25)",
    zIndex: 15,
  },
  stack: {
    position: "absolute",
    right: 20 + (FAB_SIZE - MINI_SIZE) / 2,
    alignItems: "flex-end",
    gap: MINI_GAP,
    zIndex: 20,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mini: {
    width: MINI_SIZE,
    height: MINI_SIZE,
    borderRadius: MINI_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
  },
});
