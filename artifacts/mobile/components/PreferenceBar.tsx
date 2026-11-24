import React, { useEffect } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/constants/colors";

import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { PREFERENCE_DOT_COUNT, preferenceDotIndex, snapPreference, stepPreference } from "@/lib/preferenceScale";

const DOT_COUNT = PREFERENCE_DOT_COUNT;
const THUMB_WIDTH = 38;

interface PreferenceBarProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  questionText: string;
  helperText: string;
}

export function PreferenceBar({
  value,
  onChange,
  label,
  questionText,
  helperText,
}: PreferenceBarProps) {
  const colors = useTheme();
  const { reduceMotion } = useAccessibilityPreferences();
  const selectedDot = preferenceDotIndex(value);
  const valueDescription = `${value} out of 100, position ${selectedDot + 1} of ${DOT_COUNT}; ${value < 50 ? "less preferred" : value > 50 ? "more preferred" : "impartial"}`;
  const trackWidth = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const dragStartX = useSharedValue(0);

  useEffect(() => {
    const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
    const position = preferenceDotIndex(value) / (DOT_COUNT - 1) * travel;
    thumbX.value = reduceMotion ? position : withTiming(position, { duration: 180 });
  }, [thumbX, trackWidth, value, reduceMotion]);

  const selectPosition = (rawValue: number) => {
    "worklet";
    const snappedValue = snapPreference(rawValue);
    const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
    const position = preferenceDotIndex(snappedValue) / (DOT_COUNT - 1) * travel;
    thumbX.value = reduceMotion ? position : withSpring(position, { damping: 18, stiffness: 180, mass: 0.7 });
    runOnJS(onChange)(snappedValue);
  };

  const pan = Gesture.Pan().minDistance(4)
    .onBegin(() => {
      dragStartX.value = thumbX.value;
    })
    .onUpdate((event) => {
      const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
      thumbX.value = Math.min(travel, Math.max(0, dragStartX.value + event.translationX));
    })
    .onEnd(() => {
      const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
      const rawValue = travel > 0 ? (thumbX.value / travel) * 100 : 50;
      selectPosition(rawValue);
    });

  const tap = Gesture.Tap().onEnd((event, success) => {
    if (!success) return;
    const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
    selectPosition(travel > 0 ? (event.x - THUMB_WIDTH / 2) / travel * 100 : 50);
  });
  const gesture = Gesture.Exclusive(pan, tap);
  const keyboardProps = Platform.OS === "web" ? {
    tabIndex: 0 as const,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": value,
    "aria-valuetext": valueDescription,
    onKeyDown: (event: { nativeEvent: { key?: string }; preventDefault: () => void }) => {
      const key = event.nativeEvent.key;
      const direction = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
      if (!direction && key !== "Home" && key !== "End") return;
      event.preventDefault();
      onChange(key === "Home" ? 0 : key === "End" ? 100 : stepPreference(value, direction));
    },
  } : {};

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidth.value = width;
    thumbX.value = (preferenceDotIndex(value) / (DOT_COUNT - 1)) * Math.max(0, width - THUMB_WIDTH);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.dimension, { color: colors.primary }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.question, { color: colors.foreground }]}>{questionText}</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>{helperText}</Text>

      <GestureDetector gesture={gesture}>
        <View {...keyboardProps} style={styles.gestureArea} onLayout={handleLayout}
          accessible accessibilityRole="adjustable" accessibilityLabel={questionText}
          accessibilityHint="Tap or drag to any of the 13 dots. Adjust your preference. This influences starting assignments; use Never me during chart approval to exclude yourself."
          accessibilityValue={{ min: 0, max: 100, now: value, text: valueDescription }}
          accessibilityActions={[{ name: "increment", label: "Prefer more" }, { name: "decrement", label: "Prefer less" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "increment") onChange(stepPreference(value, 1));
            if (nativeEvent.actionName === "decrement") onChange(stepPreference(value, -1));
          }}
        >
          <View style={[styles.track, { backgroundColor: colors.border }]} />
          <View pointerEvents="none" style={styles.dots}>
            {Array.from({ length: DOT_COUNT }, (_, index) => (
              <View
                key={index}
                style={[styles.dot, { backgroundColor: index === selectedDot ? colors.primary : colors.mutedForeground }]}
              />
            ))}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              { backgroundColor: colors.foreground },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>

      <View style={styles.labels}>
        <Text style={[styles.checkpointLabel, styles.leftLabel, { color: colors.mutedForeground }]}>
          NOT PREFERRED
        </Text>
        <Text style={[styles.checkpointLabel, { color: colors.mutedForeground }]}>
          IMPARTIAL
        </Text>
        <Text style={[styles.checkpointLabel, styles.rightLabel, { color: colors.mutedForeground }]}>
          PREFERRED
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 14,
  },
  dimension: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 11,
    letterSpacing: 1.8,
  },
  question: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 17,
    marginTop: 4,
  },
  helper: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
    marginTop: 2,
  },
  gestureArea: {
    height: 44,
    marginTop: 15,
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    left: THUMB_WIDTH / 2,
    right: THUMB_WIDTH / 2,
    height: 2,
    borderRadius: 1,
  },
  dots: {
    position: "absolute",
    // Align each dot's center with the thumb center at its checkpoint.
    left: THUMB_WIDTH / 2 - 2,
    right: THUMB_WIDTH / 2 - 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  thumb: {
    position: "absolute",
    left: 0,
    width: THUMB_WIDTH,
    height: 20,
    borderRadius: 10,
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 1,
  },
  checkpointLabel: {
    width: "33.333%",
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 11,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  leftLabel: { textAlign: "left" },
  rightLabel: { textAlign: "right" },
});
