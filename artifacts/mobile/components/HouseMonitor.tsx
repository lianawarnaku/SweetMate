import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";
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
import { useHouseMonitorReplay } from "@/hooks/useHouseMonitorReplay";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { getHouseMonitorProgress } from "@/lib/houseMonitorProgress";
import {
  HOUSE_MONITOR_BODY_SIZE,
  HOUSE_MONITOR_ROOF_HEIGHT,
  HOUSE_MONITOR_ROOF_PATH,
  HOUSE_MONITOR_ROOF_TRANSFORM,
  HOUSE_MONITOR_ROOF_WIDTH,
  houseMonitorRoofFillHeightFraction,
} from "@/lib/houseMonitorRoof";

export { houseMonitorGridSquares } from "@/lib/houseMonitorProgress";

const BODY_SIZE = HOUSE_MONITOR_BODY_SIZE;
const ROOF_WIDTH = HOUSE_MONITOR_ROOF_WIDTH;
const ROOF_HEIGHT = HOUSE_MONITOR_ROOF_HEIGHT;
const GRID_GAP = 3;
const TILE_CORNER_RADIUS = 5;
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
  active,
  replayNonce,
  managedReplay,
  pendingReplay,
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
  active: boolean;
  replayNonce: number;
  managedReplay: boolean;
  pendingReplay: boolean;
}) {
  const entranceScale = useSharedValue(animateNew && !reduceMotion ? 0.8 : 1);
  const fillOpacity = useSharedValue(completed && !pendingReplay ? 1 : 0);
  const bubbleProgress = useSharedValue(1);
  const previousCompleted = useRef(completed);
  const previousActive = useRef(active);
  const previousReplayNonce = useRef(0);
  // Keep outward motion inside the gap; deeper inward squash makes the
  // alternating rebounds feel watery without colliding with adjacent tiles.
  const overshoot = Math.min(0.16, 1.8 / size);
  const jiggleDegrees = Math.min(3, 50 / size);
  const squash = Math.min(0.24, 9 / size);

  useLayoutEffect(() => {
    const newlyCompleted = !managedReplay && active && previousActive.current &&
      completed && !previousCompleted.current;
    const unseenReplay = managedReplay && completed && replayNonce > 0 &&
      replayNonce !== previousReplayNonce.current;
    previousCompleted.current = completed;
    previousActive.current = active;
    previousReplayNonce.current = replayNonce;
    cancelAnimation(fillOpacity);
    cancelAnimation(bubbleProgress);
    if (pendingReplay || !active || reduceMotion || (!newlyCompleted && !unseenReplay)) {
      fillOpacity.value = pendingReplay ? 0 : Number(completed);
      bubbleProgress.value = 1;
      return;
    }

    fillOpacity.value = 0;
    bubbleProgress.value = 0;
    fillOpacity.value = withTiming(1, { duration: 100 });
    bubbleProgress.value = withSequence(
      withTiming(0.34, { duration: 210, easing: Easing.out(Easing.cubic) }),
      withTiming(0.5, { duration: 140, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.67, { duration: 100, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.83, { duration: 90, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) }),
    );
  }, [active, bubbleProgress, completed, fillOpacity, managedReplay, pendingReplay, reduceMotion, replayNonce]);

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
        [
          size / 2,
          Math.max(TILE_CORNER_RADIUS, size * 0.28),
          Math.max(TILE_CORNER_RADIUS, size * 0.16),
          TILE_CORNER_RADIUS,
        ],
      ),
      transform: [
        {
          scaleX: interpolate(
            bubbleProgress.value,
            [0, 0.34, 0.5, 0.67, 0.83, 1],
            [
              0.18,
              1 + overshoot,
              1 - squash * 0.8,
              1 + overshoot * 0.5,
              1 - squash * 0.12,
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
              1 - squash,
              1 + overshoot,
              1 - squash * 0.35,
              1 + overshoot * 0.16,
              1,
            ],
          ),
        },
        {
          rotate: `${interpolate(bubbleProgress.value, [0, 0.34, 0.5, 0.67, 0.83, 1], [0, jiggleDegrees, -jiggleDegrees * 0.66, jiggleDegrees * 0.32, -jiggleDegrees * 0.12, 0])}deg`,
        },
      ],
    }),
    [bubbleProgress, fillOpacity, jiggleDegrees, overshoot, size, squash],
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
      borderRadius: interpolate(
        bubbleProgress.value,
        [0, 1],
        [size / 2, TILE_CORNER_RADIUS],
      ),
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
  viewerId,
  householdId,
  completionTokens,
  isFocused = true,
  progressReady = true,
}: {
  totalChores: number;
  completedChores: number;
  localEvent?: HouseMonitorLocalEvent;
  viewerId?: string;
  householdId?: string;
  completionTokens?: string[];
  isFocused?: boolean;
  progressReady?: boolean;
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
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);
  const managedReplay = Boolean(viewerId && householdId && completionTokens);
  const { replay, loaded } = useHouseMonitorReplay({
    userId: viewerId,
    householdId,
    completionTokens,
    totalChores,
    completedChores,
    isFocused: isFocused && appActive,
    ready: progressReady,
  });
  const pendingReplay = managedReplay && (!loaded || !progressReady);
  const presentationActive = isFocused && appActive && progressReady && loaded;
  const replayNonce = replay?.nonce ?? 0;
  const replayFrom = replay
    ? getHouseMonitorProgress(totalChores, replay.fromCompletedChores)
    : null;
  // Keep every body a full square grid; remaining chores belong to the roof.
  const gridSide = Math.sqrt(gridSquares);
  const gridRows = gridSide;
  const roofClipId = `house-monitor-roof-${useId().replace(/:/g, "")}`;
  const restingFocus = totalChores > 0 ? 1 : 0.45;
  const focusProgress = useSharedValue(1);
  const roofProgress = useSharedValue(pendingReplay ? 0 : roofCompletionRatio);
  const roofScaleX = useSharedValue(1);
  const roofScaleY = useSharedValue(1);
  const previousRoofFill = useRef({ totalChores, completedChores, roofCompletionRatio });
  const roofWasActive = useRef(presentationActive);
  const previousRoofReplay = useRef(0);
  const monitorScale = useSharedValue(1);
  const previousGridRef = useRef(gridSquares);
  const processedEventRef = useRef(localEvent?.nonce ?? 0);
  const isNewLocalEvent = Boolean(
    localEvent && localEvent.nonce !== processedEventRef.current,
  );
  const isLocalGridGrowth = Boolean(
    isNewLocalEvent &&
    localEvent?.type === "created" &&
    gridSquares > previousGridRef.current,
  );
  const previousGrid = previousGridRef.current;

  useEffect(() => {
    focusProgress.value = reduceMotion
      ? restingFocus
      : withTiming(restingFocus, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });

    if (isNewLocalEvent) {
      if (presentationActive && !reduceMotion && localEvent?.type === "created") {
        monitorScale.value = withSequence(withSpring(1.035), withSpring(1));
      }
      processedEventRef.current = localEvent?.nonce ?? 0;
    }
    if (reduceMotion || !presentationActive) {
      cancelAnimation(monitorScale);
      monitorScale.value = 1;
    }
    previousGridRef.current = gridSquares;
  }, [
    completedChores,
    gridSquares,
    isNewLocalEvent,
    localEvent,
    presentationActive,
    focusProgress,
    monitorScale,
    reduceMotion,
    restingFocus,
    roofCompletionRatio,
    roofProgress,
  ]);

  useLayoutEffect(() => {
    const previous = previousRoofFill.current;
    const wasActive = roofWasActive.current;
    roofWasActive.current = presentationActive;
    const unseenReplay = managedReplay && replayNonce > 0 && replayNonce !== previousRoofReplay.current;
    previousRoofReplay.current = replayNonce;
    previousRoofFill.current = { totalChores, completedChores, roofCompletionRatio };
    cancelAnimation(roofScaleX);
    cancelAnimation(roofScaleY);
    const replayRoofStart = replayFrom?.roofCompletionRatio ?? roofCompletionRatio;
    const gainedRoofFill = presentationActive && (managedReplay
      ? unseenReplay && replayRoofStart < roofCompletionRatio
      : wasActive && totalChores === previous.totalChores &&
        completedChores > previous.completedChores && roofCompletionRatio > previous.roofCompletionRatio);
    if (pendingReplay) {
      roofProgress.value = 0;
    } else if (!presentationActive || reduceMotion || (!wasActive && !gainedRoofFill)) {
      roofProgress.value = roofCompletionRatio;
    } else {
      if (gainedRoofFill && managedReplay) roofProgress.value = replayRoofStart;
      roofProgress.value = withTiming(roofCompletionRatio, {
        duration: 400, easing: Easing.out(Easing.cubic),
      });
    }

    if (reduceMotion || !gainedRoofFill) {
      roofScaleX.value = 1;
      roofScaleY.value = 1;
      return;
    }

    // Restart from the current shape on rapid completions, without a visual jump.
    // Squash inward more than outward so the centered roof stays clear of the grid.
    roofScaleX.value = withSequence(
      withTiming(1.012, { duration: 210, easing: Easing.out(Easing.cubic) }),
      withTiming(0.975, { duration: 140, easing: Easing.inOut(Easing.quad) }),
      withTiming(1.006, { duration: 100, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.992, { duration: 90, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) }),
    );
    roofScaleY.value = withSequence(
      withTiming(0.92, { duration: 210, easing: Easing.out(Easing.cubic) }),
      withTiming(1.018, { duration: 140, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.97, { duration: 100, easing: Easing.inOut(Easing.quad) }),
      withTiming(1.006, { duration: 90, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) }),
    );
  }, [completedChores, managedReplay, pendingReplay, presentationActive, reduceMotion, replayNonce, replayFrom?.roofCompletionRatio, roofCompletionRatio, roofProgress, roofScaleX, roofScaleY, totalChores]);

  useEffect(() => () => {
    cancelAnimation(roofScaleX);
    cancelAnimation(roofScaleY);
  }, [roofScaleX, roofScaleY]);

  const roofBubbleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: roofScaleX.value }, { scaleY: roofScaleY.value }],
  }));

  const monitorStyle = useAnimatedStyle(
    () => ({
      opacity: interpolate(focusProgress.value, [0, 1], [0.42, 1]),
      transform: [{ scale: monitorScale.value }],
    }),
    [focusProgress, monitorScale],
  );
  const roofFillProps = useAnimatedProps(() => {
    // Use the rounded roof's area so soft corners cannot distort progress.
    const fillHeight =
      ROOF_HEIGHT * houseMonitorRoofFillHeightFraction(roofProgress.value);
    return { y: ROOF_HEIGHT - fillHeight, height: fillHeight };
  }, [roofProgress]);
  const squareSize = (BODY_SIZE - GRID_GAP * (gridSide - 1)) / gridSide;

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
        <Animated.View
          style={[styles.roof, { width: ROOF_WIDTH, height: ROOF_HEIGHT }, roofBubbleStyle]}
        >
        <Svg
          width={ROOF_WIDTH}
          height={ROOF_HEIGHT}
          viewBox={`0 0 ${ROOF_WIDTH} ${ROOF_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <Defs>
            <ClipPath id={roofClipId}>
              <Path
                d={HOUSE_MONITOR_ROOF_PATH}
                transform={HOUSE_MONITOR_ROOF_TRANSFORM}
              />
            </ClipPath>
          </Defs>
          <Path
            d={HOUSE_MONITOR_ROOF_PATH}
            transform={HOUSE_MONITOR_ROOF_TRANSFORM}
            fill={faintThemeColor(
              colors.primary,
              colors.background,
              0.1,
              reduceTransparency,
            )}
          />
          <AnimatedRect
            x={0}
            width={ROOF_WIDTH}
            fill={colors.primary}
            clipPath={`url(#${roofClipId})`}
            animatedProps={roofFillProps}
          />
          <Path
            d={HOUSE_MONITOR_ROOF_PATH}
            transform={HOUSE_MONITOR_ROOF_TRANSFORM}
            fill="none"
            vectorEffect="non-scaling-stroke"
            stroke={faintThemeColor(
              colors.primary,
              colors.background,
              0.3,
              reduceTransparency,
            )}
            strokeWidth={2}
          />
        </Svg>
        </Animated.View>
        <View style={[styles.grid, { gap: GRID_GAP }]}>
          {Array.from({ length: gridRows }, (_, row) => (
            <View key={row} style={[styles.gridRow, { gap: GRID_GAP }]}>
              {Array.from({ length: gridSide }, (_, column) => {
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
                      active={presentationActive}
                      managedReplay={managedReplay}
                      pendingReplay={pendingReplay}
                      replayNonce={replayFrom && index >= replayFrom.filledSquares && index < filledSquares ? replayNonce : 0}
                      size={squareSize}
                      reduceMotion={reduceMotion}
                      reduceTransparency={reduceTransparency}
                      delay={index * 24}
                      animateNew={isLocalGridGrowth && index >= previousGrid && (!managedReplay || index >= filledSquares)}
                    />
                  </View>
                );
              })}
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
  root: { alignItems: "center", minWidth: Math.max(140, ROOF_WIDTH) },
  monitor: { width: ROOF_WIDTH, flexDirection: "column", alignItems: "center" },
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
    borderRadius: TILE_CORNER_RADIUS,
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
