import React, { type ReactNode, useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";

import { useTheme } from "@/constants/colors";

const MARK_SIZE = 224;
const SCALE = MARK_SIZE / 256;

function BouncyPiece({
  children,
  delay,
  style,
}: {
  children: ReactNode;
  delay: number;
  style: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSpring(1, { damping: 9, stiffness: 190, mass: 0.65 }),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 18 },
      { scale: progress.value },
    ],
  }));

  return <Animated.View style={[styles.piece, style, animatedStyle]}>{children}</Animated.View>;
}

function Tile({ color }: { color: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 58 52">
      <Rect width="58" height="52" rx="13" fill={color} />
    </Svg>
  );
}

export function HouseLoader() {
  const colors = useTheme();
  const tileStyle = { width: 58 * SCALE, height: 52 * SCALE };

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your household"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.mark}>
        <BouncyPiece delay={0} style={[tileStyle, { left: 64 * SCALE, top: 139 * SCALE }]}>
          <Tile color={colors.primary} />
        </BouncyPiece>
        <BouncyPiece delay={70} style={[tileStyle, { left: 134 * SCALE, top: 139 * SCALE }]}>
          <Tile color={colors.primary} />
        </BouncyPiece>
        <BouncyPiece delay={140} style={[tileStyle, { left: 64 * SCALE, top: 198 * SCALE }]}>
          <Tile color={colors.primary} />
        </BouncyPiece>
        <BouncyPiece delay={210} style={[tileStyle, { left: 134 * SCALE, top: 198 * SCALE }]}>
          <Tile color={colors.primary} />
        </BouncyPiece>
        <BouncyPiece delay={390} style={styles.roof}>
          <Svg width="100%" height="100%" viewBox="0 0 256 139">
            <Path
              d="M128 35c4.3 0 8.3 1.7 11.4 4.7l82.8 80.6c5.4 5.3 1.7 14.5-5.9 14.5H39.7c-7.6 0-11.3-9.2-5.9-14.5l82.8-80.6c3.1-3 7.1-4.7 11.4-4.7Z"
              fill={colors.primary}
            />
          </Svg>
        </BouncyPiece>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
  piece: { position: "absolute" },
  roof: { left: 0, top: 0, width: MARK_SIZE, height: 139 * SCALE },
});
