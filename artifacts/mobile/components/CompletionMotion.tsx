import React, { useEffect, useMemo, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { useTheme } from "@/constants/colors";

type CompletionMotionProps = ViewProps & {
  completed: boolean;
  departing?: boolean;
  /** Expenses use a gentler version of the same response. */
  subtle?: boolean;
};

/** Local feedback follows data changes; mounting completed history stays still. */
export function CompletionMotion({
  completed,
  departing = false,
  subtle = false,
  children,
  style,
  ...props
}: CompletionMotionProps) {
  const { reduceMotion } = useAccessibilityPreferences();
  const previousCompleted = useRef(completed);
  const wobble = useSharedValue(1);
  const departure = useSharedValue(0);
  const strength = subtle ? 0.55 : 1;
  const styleOpacity = StyleSheet.flatten(style)?.opacity;
  const baseOpacity = typeof styleOpacity === "number" ? styleOpacity : 1;
  const layout = useMemo(
    () => reduceMotion ? undefined : LinearTransition.duration(240).easing(Easing.out(Easing.cubic)),
    [reduceMotion],
  );

  useEffect(() => {
    const newlyCompleted = completed && !previousCompleted.current;
    previousCompleted.current = completed;
    cancelAnimation(wobble);
    cancelAnimation(departure);
    wobble.value = 1;
    departure.value = 0;
    if (reduceMotion) return;

    if (newlyCompleted) {
      wobble.value = 0;
      wobble.value = withSequence(
        withTiming(0.32, { duration: 150, easing: Easing.out(Easing.cubic) }),
        withTiming(0.5, { duration: 90, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.69, { duration: 100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.84, { duration: 90, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 90, easing: Easing.out(Easing.cubic) }),
      );
    }
    if (completed && departing) {
      departure.value = withDelay(
        360,
        withTiming(1, { duration: 260, easing: Easing.in(Easing.cubic) }),
      );
    }
    return () => {
      cancelAnimation(wobble);
      cancelAnimation(departure);
    };
  }, [completed, departing, reduceMotion, wobble, departure]);

  const motionStyle = useAnimatedStyle(() => {
    const phases = [0, 0.32, 0.5, 0.69, 0.84, 1];
    const angle = interpolate(wobble.value, phases, [0, -0.65, 0.45, -0.24, 0.1, 0]) * strength;
    const x = interpolate(wobble.value, phases, [1, 1.014, 0.994, 1.005, 0.998, 1]);
    const y = interpolate(wobble.value, phases, [1, 0.94, 1.04, 0.98, 1.009, 1]);
    return {
      opacity: baseOpacity * interpolate(departure.value, [0, 0.18, 1], [1, 1, 0]),
      transform: [
        { translateX: interpolate(departure.value, [0, 0.35, 1], [0, -3, 38]) },
        { translateY: interpolate(wobble.value, phases, [0, -1.5, 0.8, -0.4, 0.15, 0]) * strength - departure.value * 6 },
        { rotate: (angle + interpolate(departure.value, [0, 0.4, 1], [0, -0.5, 1.6])) + "deg" },
        { scaleX: (1 + (x - 1) * strength) * interpolate(departure.value, [0, 0.25, 1], [1, 1.015, 0.82]) },
        { scaleY: (1 + (y - 1) * strength) * interpolate(departure.value, [0, 0.25, 1], [1, 1.025, 0.8]) },
      ],
    };
  }, [strength, baseOpacity]);

  return (
    <Animated.View {...props} layout={layout} style={[style, motionStyle]}>
      {children}
    </Animated.View>
  );
}

type CompletionTextProps = TextProps & {
  completed: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

/** A growing strike for single-line labels; native strikes preserve wrapped text. */
export function CompletionText({
  completed,
  containerStyle,
  children,
  style,
  numberOfLines = 1,
  ...props
}: CompletionTextProps) {
  const { reduceMotion } = useAccessibilityPreferences();
  const colors = useTheme();
  const previousCompleted = useRef(completed);
  const strike = useSharedValue(completed ? 1 : 0);
  const multiline = numberOfLines !== 1;
  const textStyle = StyleSheet.flatten(style) as TextStyle | undefined;

  useEffect(() => {
    const newlyCompleted = completed && !previousCompleted.current;
    previousCompleted.current = completed;
    cancelAnimation(strike);
    strike.value = newlyCompleted && !reduceMotion
      ? 0
      : Number(completed);
    if (newlyCompleted && !reduceMotion) {
      strike.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    }
    return () => cancelAnimation(strike);
  }, [completed, reduceMotion, strike]);

  const strikeStyle = useAnimatedStyle(() => ({
    width: (strike.value * 100) + "%" as `${number}%`,
    opacity: strike.value,
  }));

  return (
    <View style={[styles.label, containerStyle]}>
      <Text
        {...props}
        numberOfLines={numberOfLines}
        style={[
          style,
          { textDecorationLine: multiline && completed ? "line-through" : "none" },
        ]}
      >
        {children}
      </Text>
      {!multiline && (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          style={[
            styles.strike,
            { backgroundColor: textStyle?.color ?? colors.mutedForeground },
            strikeStyle,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { alignSelf: "flex-start", maxWidth: "100%", position: "relative" },
  strike: { position: "absolute", left: 0, top: "50%", height: 1.25, borderRadius: 1 },
});
