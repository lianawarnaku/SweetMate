import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Polygon, Rect } from "react-native-svg";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useTheme } from "@/constants/colors";

const BODY_SIZE = 112;
const ROOF_HEIGHT = 52;
const GRID_GAP = 3;
const AnimatedRect = Animated.createAnimatedComponent(Rect);

export type HouseMonitorLocalEvent = {
  nonce: number;
  type: "created" | "completed";
};

export function houseMonitorGridSquares(totalChores: number) {
  const capped = Math.min(Math.max(totalChores, 0), 25);
  if (capped >= 25) return 25;
  if (capped >= 16) return 16;
  if (capped >= 9) return 9;
  return 4;
}

function mixThemeColors(base: string, toward: string, amount: number) {
  const parse = (color: string) => {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
    return match
      ? [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
      : null;
  };
  const from = parse(base);
  const to = parse(toward);
  if (!from || !to) return base;
  const channel = (index: number) => Math.round(
    from[index] + (to[index] - from[index]) * amount,
  ).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function GridSquare({
  color,
  dullColor,
  focusProgress,
  focusEpoch,
  delay,
  animateNew,
}: {
  color: string;
  dullColor: string;
  focusProgress: SharedValue<number>;
  focusEpoch: number;
  delay: number;
  animateNew: boolean;
}) {
  const scale = useSharedValue(animateNew ? 0.8 : 1);
  const previousFocusEpoch = useRef(focusEpoch);

  useEffect(() => {
    if (animateNew) {
      scale.value = withDelay(
        delay,
        withSequence(withSpring(1.05), withSpring(1)),
      );
    }
  }, [animateNew, delay, scale]);

  useEffect(() => {
    if (previousFocusEpoch.current === focusEpoch) return;
    previousFocusEpoch.current = focusEpoch;
    scale.value = 0.8;
    scale.value = withDelay(
      delay,
      withSequence(withSpring(1.05), withSpring(1)),
    );
  }, [delay, focusEpoch, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [dullColor, color],
    ),
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[styles.square, animatedStyle]} />;
}

export function HouseMonitor({
  totalChores,
  completedChores,
  localEvent,
}: {
  totalChores: number;
  completedChores: number;
  localEvent?: HouseMonitorLocalEvent;
}) {
  const colors = useTheme();
  const gridSquares = houseMonitorGridSquares(totalChores);
  const gridSide = Math.sqrt(gridSquares);
  const completionRatio = totalChores > 0
    ? Math.min(Math.max(completedChores / totalChores, 0), 1)
    : 0;
  const restingFocus = totalChores > 0 ? 1 : 0.45;
  const [focusEpoch, setFocusEpoch] = useState(0);
  const focusProgress = useSharedValue(0);
  const roofProgress = useSharedValue(0);
  const monitorScale = useSharedValue(1);
  const completionRatioRef = useRef(completionRatio);
  const restingFocusRef = useRef(restingFocus);
  completionRatioRef.current = completionRatio;
  restingFocusRef.current = restingFocus;
  const previousGridRef = useRef(gridSquares);
  const previousCompletedRef = useRef(completedChores);
  const processedEventRef = useRef(0);
  const isNewLocalEvent = Boolean(
    localEvent && localEvent.nonce !== processedEventRef.current,
  );
  const isLocalGridGrowth = Boolean(
    isNewLocalEvent &&
      localEvent?.type === "created" &&
      gridSquares > previousGridRef.current,
  );
  const previousGrid = previousGridRef.current;

  const squareColors = useMemo(
    () => [
      colors.primary,
      mixThemeColors(colors.primary, colors.background, 0.16),
      mixThemeColors(colors.primary, colors.foreground, 0.18),
      mixThemeColors(colors.primary, colors.background, 0.3),
    ],
    [colors.background, colors.foreground, colors.primary],
  );

  useFocusEffect(
    useCallback(() => {
      focusProgress.value = 0;
      roofProgress.value = 0;
      monitorScale.value = 0.96;
      setFocusEpoch((current) => current + 1);
      focusProgress.value = withTiming(restingFocusRef.current, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
      });
      roofProgress.value = withDelay(
        160,
        withTiming(completionRatioRef.current, {
          duration: 650,
          easing: Easing.out(Easing.cubic),
        }),
      );
      monitorScale.value = withSpring(1);
    }, [focusProgress, monitorScale, roofProgress]),
  );

  useEffect(() => {
    focusProgress.value = withTiming(restingFocus, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
    roofProgress.value = withTiming(completionRatio, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });

    if (isNewLocalEvent) {
      if (
        localEvent?.type === "completed" &&
        completedChores > previousCompletedRef.current
      ) {
        monitorScale.value = withSequence(
          withSpring(1.055),
          withSpring(1),
        );
      } else if (localEvent?.type === "created") {
        monitorScale.value = withSequence(
          withSpring(1.035),
          withSpring(1),
        );
      }
      processedEventRef.current = localEvent?.nonce ?? 0;
    }

    previousGridRef.current = gridSquares;
    previousCompletedRef.current = completedChores;
  }, [
    completedChores,
    completionRatio,
    gridSquares,
    isNewLocalEvent,
    localEvent,
    focusProgress,
    monitorScale,
    restingFocus,
    roofProgress,
  ]);

  const monitorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focusProgress.value, [0, 1], [0.42, 1]),
    transform: [{ scale: monitorScale.value }],
  }));
  const roofFillProps = useAnimatedProps(() => ({
    y: ROOF_HEIGHT * (1 - roofProgress.value),
    height: ROOF_HEIGHT * roofProgress.value,
  }));
  const squareSize = (BODY_SIZE - GRID_GAP * (gridSide - 1)) / gridSide;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`House Monitor. ${completedChores} of ${totalChores} household chores complete.`}
      style={styles.root}
    >
      <Animated.View style={[styles.monitor, monitorStyle]}>
        <Svg width={BODY_SIZE} height={ROOF_HEIGHT}>
          <Defs>
            <ClipPath id="house-monitor-roof">
              <Polygon points={`0,${ROOF_HEIGHT} ${BODY_SIZE / 2},0 ${BODY_SIZE},${ROOF_HEIGHT}`} />
            </ClipPath>
          </Defs>
          <Polygon
            points={`0,${ROOF_HEIGHT} ${BODY_SIZE / 2},0 ${BODY_SIZE},${ROOF_HEIGHT}`}
            fill={colors.muted}
            stroke={colors.border}
            strokeWidth={2}
          />
          <AnimatedRect
            x={0}
            width={BODY_SIZE}
            fill={colors.primary}
            clipPath="url(#house-monitor-roof)"
            animatedProps={roofFillProps}
          />
        </Svg>
        <View style={[styles.grid, { gap: GRID_GAP }]}>
          {Array.from({ length: gridSquares }, (_, index) => (
            <View key={index} style={{ width: squareSize, height: squareSize }}>
              <GridSquare
                color={squareColors[index % squareColors.length]}
                dullColor={colors.mutedForeground}
                focusProgress={focusProgress}
                focusEpoch={focusEpoch}
                delay={index * 24}
                animateNew={isLocalGridGrowth && index >= previousGrid}
              />
            </View>
          ))}
        </View>
      </Animated.View>
      <Text style={[styles.progress, { color: colors.foreground }]}>
        {Math.round(completionRatio * 100)}%
      </Text>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>
        {completedChores} of {totalChores} chores complete
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", minWidth: 140 },
  monitor: { alignItems: "center" },
  grid: {
    width: BODY_SIZE,
    height: BODY_SIZE,
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 3,
  },
  square: { flex: 1, borderRadius: 3 },
  progress: { fontFamily: "Inter_700Bold", fontSize: 20, marginTop: 8 },
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
});
