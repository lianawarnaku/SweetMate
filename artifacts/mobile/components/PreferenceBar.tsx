import React, { useEffect } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/constants/colors";

// Change this one switch to false if preference bars should remain fully continuous.
const SNAP_TO_CHECKPOINTS = true;
const CHECKPOINTS = [0, 50, 100] as const;
const DOT_COUNT = 13;
const THUMB_WIDTH = 38;

interface PreferenceBarProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  questionText: string;
  helperText: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function resolvePreferenceValue(rawValue: number): number {
  "worklet";
  if (!SNAP_TO_CHECKPOINTS) return Math.round(rawValue);
  return CHECKPOINTS.reduce((nearest, checkpoint) =>
    Math.abs(checkpoint - rawValue) < Math.abs(nearest - rawValue)
      ? checkpoint
      : nearest,
  );
}

export function PreferenceBar({
  value,
  onChange,
  label,
  questionText,
  helperText,
}: PreferenceBarProps) {
  const colors = useTheme();
  const trackWidth = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const dragStartX = useSharedValue(0);

  useEffect(() => {
    const travel = Math.max(0, trackWidth.value - THUMB_WIDTH);
    thumbX.value = withTiming((clamp(value, 0, 100) / 100) * travel, {
      duration: 180,
    });
  }, [thumbX, trackWidth, value]);

  const pan = Gesture.Pan()
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
      const snappedValue = resolvePreferenceValue(rawValue);
      thumbX.value = withSpring((snappedValue / 100) * travel, {
        damping: 18,
        stiffness: 180,
        mass: 0.7,
      });
      runOnJS(onChange)(snappedValue);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidth.value = width;
    thumbX.value = (clamp(value, 0, 100) / 100) * Math.max(0, width - THUMB_WIDTH);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.dimension, { color: colors.primary }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.question, { color: colors.foreground }]}>{questionText}</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>{helperText}</Text>

      <GestureDetector gesture={pan}>
        <View style={styles.gestureArea} onLayout={handleLayout}>
          <View style={[styles.track, { backgroundColor: colors.border }]} />
          <View style={styles.dots}>
            {Array.from({ length: DOT_COUNT }, (_, index) => (
              <View
                key={index}
                style={[styles.dot, { backgroundColor: colors.mutedForeground }]}
              />
            ))}
          </View>
          <Animated.View
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
    fontSize: 10,
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
    height: 42,
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
    left: THUMB_WIDTH / 2,
    right: THUMB_WIDTH / 2,
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
    fontSize: 8,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  leftLabel: { textAlign: "left" },
  rightLabel: { textAlign: "right" },
});
