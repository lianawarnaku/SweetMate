import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";

type CheckCircleState = "idle" | "checked" | "overdue";

export function GlassCheckCircle({
  state = "idle",
  size = 24,
}: {
  state?: CheckCircleState;
  size?: number;
}) {
  const colors = useTheme();
  const activeColor = state === "overdue" ? colors.primary : colors.success;
  const active = state !== "idle";
  const { reduceMotion } = useAccessibilityPreferences();
  const previousState = useRef(state);
  const checkScale = useSharedValue(1);

  useEffect(() => {
    const newlyChecked = state === "checked" && previousState.current !== "checked";
    previousState.current = state;
    cancelAnimation(checkScale);
    checkScale.value = 1;
    if (newlyChecked && !reduceMotion) {
      checkScale.value = 0.7;
      checkScale.value = withSequence(
        withTiming(1.16, { duration: 110, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { duration: 160, dampingRatio: 0.7 }),
      );
    }
    return () => cancelAnimation(checkScale);
  }, [checkScale, reduceMotion, state]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: active ? activeColor : colors.mutedForeground,
        },
      ]}
    >
      <BlurView
        intensity={42}
        tint="dark"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, overflow: "hidden" },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            overflow: "hidden",
            backgroundColor: active
              ? activeColor + "26"
              : "rgba(255,255,255,0.035)",
          },
        ]}
      />
      {active ? (
        <Animated.View style={checkStyle}>
          <Feather
            name={state === "overdue" ? "alert-circle" : "check"}
            size={Math.max(11, size * 0.5)}
            color={activeColor}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1.7,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
