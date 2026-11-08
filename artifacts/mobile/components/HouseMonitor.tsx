import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useId, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Polygon, Rect } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import {
  getHouseMonitorProgress,
  roofFillHeightFraction,
} from "@/lib/houseMonitorProgress";

export { houseMonitorGridSquares } from "@/lib/houseMonitorProgress";

const BODY_SIZE = 112;
const ROOF_HEIGHT = 52;
const GRID_GAP = 3;
const AnimatedRect = Animated.createAnimatedComponent(Rect);

export type HouseMonitorLocalEvent = {
  nonce: number;
  type: "created" | "completed";
};

function mixThemeColors(base: string, toward: string, amount: number) {
  const parse = (color: string) => {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
    return match
      ? [
          Number.parseInt(match[1], 16),
          Number.parseInt(match[2], 16),
          Number.parseInt(match[3], 16),
        ]
      : null;
  };
  const from = parse(base);
  const to = parse(toward);
  if (!from || !to) return base;
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function faintThemeColor(
  color: string,
  background: string,
  opacity: number,
  opaque: boolean,
) {
  if (opaque || !/^#[\da-f]{6}$/i.test(color))
    return mixThemeColors(background, color, opacity);
  return `${color}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function GridSquare({
  color,
  emptyColor,
  emptyBorderColor,
  completed,
  size,
  reduceMotion,
  reduceTransparency,
  delay,
  animateNew,
}: {
  color: string;
  emptyColor: string;
  emptyBorderColor: string;
  completed: boolean;
  size: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  delay: number;
  animateNew: boolean;
}) {
  const entranceScale = useSharedValue(animateNew && !reduceMotion ? 0.8 : 1);
  const fillOpacity = useSharedValue(completed ? 1 : 0);
  const bubbleProgress = useSharedValue(1);
  const previousCompleted = useRef(completed);
  // Jointly budget the bloom and rotation to stay inside half of the 3px gap,
  // even when two neighboring chores complete in the same update.
  const overshoot = Math.min(0.16, 1.8 / size);
  const jiggleDegrees = Math.min(3, 50 / size);

  useEffect(() => {
    const newlyCompleted = completed && !previousCompleted.current;
    previousCompleted.current = completed;
    cancelAnimation(fillOpacity);
    cancelAnimation(bubbleProgress);
    if (reduceMotion || !newlyCompleted) {
      fillOpacity.value = Number(completed);
      bubbleProgress.value = 1;
      return;
    }

    fillOpacity.value = 0;
    bubbleProgress.value = 0;
    fillOpacity.value = withTiming(1, { duration: 100 });
    bubbleProgress.value = withSequence(
      withTiming(0.34, { duration: 210, easing: Easing.out(Easing.cubic) }),
      withTiming(0.5, { duration: 110, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.67, { duration: 100, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.83, { duration: 90, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) }),
    );
  }, [bubbleProgress, completed, fillOpacity, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(entranceScale);
      entranceScale.value = 1;
    } else if (animateNew) {
      entranceScale.value = withDelay(delay, withSpring(1));
    }
  }, [animateNew, delay, entranceScale, reduceMotion]);

  const entranceStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: entranceScale.value }],
    }),
    [entranceScale],
  );
  const bubbleStyle = useAnimatedStyle(
    () => ({
      opacity: fillOpacity.value,
      borderRadius: interpolate(
        bubbleProgress.value,
        [0, 0.34, 0.6, 1],
        [size / 2, Math.max(3, size * 0.22), Math.max(3, size * 0.1), 3],
      ),
      transform: [
        {
          scaleX: interpolate(
            bubbleProgress.value,
            [0, 0.34, 0.5, 0.67, 0.83, 1],
            [
              0.18,
              1 + overshoot,
              1 - overshoot * 0.5,
              1 + overshoot * 0.22,
              1 - overshoot * 0.1,
              1,
            ],
          ),
        },
        {
          scaleY: interpolate(
            bubbleProgress.value,
            [0, 0.34, 0.5, 0.67, 0.83, 1],
            [
              0.18,
              1 - overshoot * 0.8,
              1 + overshoot,
              1 - overshoot * 0.28,
              1 + overshoot * 0.12,
              1,
            ],
          ),
        },
        {
          rotate: `${interpolate(bubbleProgress.value, [0, 0.34, 0.5, 0.67, 0.83, 1], [0, jiggleDegrees, -jiggleDegrees * 0.66, jiggleDegrees * 0.32, -jiggleDegrees * 0.12, 0])}deg`,
        },
      ],
    }),
    [bubbleProgress, fillOpacity, jiggleDegrees, overshoot, size],
  );
  const haloStyle = useAnimatedStyle(
    () => ({
      opacity:
        reduceMotion || reduceTransparency
          ? 0
          : interpolate(
              bubbleProgress.value,
              [0, 0.16, 0.48, 0.72, 1],
              [0, 0.28, 0.15, 0, 0],
            ),
      borderRadius: interpolate(bubbleProgress.value, [0, 1], [size / 2, 3]),
      transform: [
        {
          scale: interpolate(
            bubbleProgress.value,
            [0, 0.72, 1],
            [0.75, 1 + Math.min(0.22, 6 / size), 1],
          ),
        },
      ],
    }),
    [bubbleProgress, reduceMotion, reduceTransparency, size],
  );

  return (
    <Animated.View style={[styles.squareContainer, entranceStyle]}>
      <View
        style={[
          styles.squareOutline,
          { backgroundColor: emptyColor, borderColor: emptyBorderColor },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.squareHalo, { borderColor: color }, haloStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.squareFill,
          { backgroundColor: color, borderColor: color },
          bubbleStyle,
        ]}
      />
    </Animated.View>
  );
}

export function HouseMonitor({
  totalChores: rawTotalChores,
  completedChores: rawCompletedChores,
  localEvent,
}: {
  totalChores: number;
  completedChores: number;
  localEvent?: HouseMonitorLocalEvent;
}) {
  const colors = useTheme();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const {
    totalChores,
    completedChores,
    gridSquares,
    filledSquares,
    completionPercentage: percentage,
    roofCompletionRatio,
  } = getHouseMonitorProgress(rawTotalChores, rawCompletedChores);
  // Small households have only real chore boxes, with no invisible padding
  // that could make the roof look offset above a lone completed box.
  const visibleSquares =
    totalChores > 0 ? Math.min(totalChores, gridSquares) : gridSquares;
  const gridSide = Math.ceil(Math.sqrt(visibleSquares));
  const gridRows = Math.ceil(visibleSquares / gridSide);
  const roofClipId = `house-monitor-roof-${useId().replace(/:/g, "")}`;
  const restingFocus = totalChores > 0 ? 1 : 0.45;
  const focusProgress = useSharedValue(1);
  const roofProgress = useSharedValue(roofCompletionRatio);
  const monitorScale = useSharedValue(1);
  const roofCompletionRatioRef = useRef(roofCompletionRatio);
  const restingFocusRef = useRef(restingFocus);
  roofCompletionRatioRef.current = roofCompletionRatio;
  restingFocusRef.current = restingFocus;
  const previousGridRef = useRef(gridSquares);
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

  useFocusEffect(
    useCallback(() => {
      // Entrance motion never changes which chores are represented as complete.
      roofProgress.value = roofCompletionRatioRef.current;
      if (reduceMotion) {
        focusProgress.value = restingFocusRef.current;
        monitorScale.value = 1;
        return;
      }
      focusProgress.value = 0;
      monitorScale.value = 0.96;
      focusProgress.value = withTiming(restingFocusRef.current, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
      monitorScale.value = withSpring(1);
    }, [focusProgress, monitorScale, reduceMotion, roofProgress]),
  );

  useEffect(() => {
    focusProgress.value = reduceMotion
      ? restingFocus
      : withTiming(restingFocus, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });
    roofProgress.value = reduceMotion
      ? roofCompletionRatio
      : withTiming(roofCompletionRatio, {
          duration: 400,
          easing: Easing.out(Easing.cubic),
        });

    if (isNewLocalEvent) {
      if (!reduceMotion && localEvent?.type === "created") {
        monitorScale.value = withSequence(withSpring(1.035), withSpring(1));
      }
      processedEventRef.current = localEvent?.nonce ?? 0;
    }
    if (reduceMotion) monitorScale.value = 1;
    previousGridRef.current = gridSquares;
  }, [
    completedChores,
    gridSquares,
    isNewLocalEvent,
    localEvent,
    focusProgress,
    monitorScale,
    reduceMotion,
    restingFocus,
    roofCompletionRatio,
    roofProgress,
  ]);

  const monitorStyle = useAnimatedStyle(
    () => ({
      opacity: interpolate(focusProgress.value, [0, 1], [0.42, 1]),
      transform: [{ scale: monitorScale.value }],
    }),
    [focusProgress, monitorScale],
  );
  const roofFillProps = useAnimatedProps(() => {
    // A triangle narrows toward its peak: use area, rather than raw height.
    const fillHeight = ROOF_HEIGHT * roofFillHeightFraction(roofProgress.value);
    return { y: ROOF_HEIGHT - fillHeight, height: fillHeight };
  }, [roofProgress]);
  const squareSize = (BODY_SIZE - GRID_GAP * (gridSide - 1)) / gridSide;
  const roofPoints = `0,${ROOF_HEIGHT} ${BODY_SIZE / 2},0 ${BODY_SIZE},${ROOF_HEIGHT}`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="House Monitor"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: percentage,
        text: `${completedChores} of ${totalChores} household chores complete.`,
      }}
      style={styles.root}
    >
      <Animated.View
        style={[styles.monitor, monitorStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg
          width={BODY_SIZE}
          height={ROOF_HEIGHT}
          viewBox={`0 0 ${BODY_SIZE} ${ROOF_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={styles.roof}
        >
          <Defs>
            <ClipPath id={roofClipId}>
              <Polygon points={roofPoints} />
            </ClipPath>
          </Defs>
          <Polygon
            points={roofPoints}
            fill={faintThemeColor(
              colors.primary,
              colors.background,
              0.1,
              reduceTransparency,
            )}
          />
          <AnimatedRect
            x={0}
            width={BODY_SIZE}
            fill={colors.primary}
            clipPath={`url(#${roofClipId})`}
            animatedProps={roofFillProps}
          />
          <Polygon
            points={roofPoints}
            fill="none"
            stroke={faintThemeColor(
              colors.primary,
              colors.background,
              0.3,
              reduceTransparency,
            )}
            strokeWidth={2}
          />
        </Svg>
        <View style={[styles.grid, { gap: GRID_GAP }]}>
          {Array.from({ length: gridRows }, (_, row) => (
            <View key={row} style={[styles.gridRow, { gap: GRID_GAP }]}>
              {Array.from(
                { length: Math.min(gridSide, visibleSquares - row * gridSide) },
                (_, column) => {
                  const index = row * gridSide + column;
                  return (
                    <View
                      key={index}
                      style={{
                        width: squareSize,
                        height: squareSize,
                        flexShrink: 0,
                      }}
                    >
                      <GridSquare
                        color={colors.primary}
                        emptyColor={faintThemeColor(
                          colors.primary,
                          colors.background,
                          totalChores === 0 ? 0.04 : 0.1,
                          reduceTransparency,
                        )}
                        emptyBorderColor={faintThemeColor(
                          colors.primary,
                          colors.background,
                          totalChores === 0 ? 0.12 : 0.3,
                          reduceTransparency,
                        )}
                        completed={index < filledSquares}
                        size={squareSize}
                        reduceMotion={reduceMotion}
                        reduceTransparency={reduceTransparency}
                        delay={index * 24}
                        animateNew={isLocalGridGrowth && index >= previousGrid}
                      />
                    </View>
                  );
                },
              )}
            </View>
          ))}
        </View>
      </Animated.View>
      <Text style={[styles.progress, { color: colors.foreground }]}>
        {percentage}%
      </Text>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>
        {completedChores} of {totalChores} chores complete
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", minWidth: 140 },
  monitor: { width: BODY_SIZE, flexDirection: "column", alignItems: "center" },
  roof: { alignSelf: "center", flexShrink: 0 },
  grid: {
    width: BODY_SIZE,
    alignItems: "center",
    flexDirection: "column",
    marginTop: 3,
  },
  gridRow: { width: BODY_SIZE, flexDirection: "row", justifyContent: "center" },
  squareContainer: { flex: 1, position: "relative", overflow: "visible" },
  squareOutline: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 3,
    borderWidth: 1,
  },
  squareFill: { ...StyleSheet.absoluteFillObject, borderWidth: 1 },
  squareHalo: { ...StyleSheet.absoluteFillObject, borderWidth: 1 },
  progress: {
    fontFamily: "Inter_700Bold",
    includeFontPadding: false,
    fontSize: 20,
    marginTop: 8,
  },
  caption: {
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 12,
    marginTop: 2,
  },
});
