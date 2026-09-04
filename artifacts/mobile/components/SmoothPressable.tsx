import React from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { tapLight } from "@/lib/haptics";

type SmoothPressableProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  haptic?: boolean;
};

export function SmoothPressable({
  style,
  containerStyle,
  haptic = true,
  disabled,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop = 4,
  onPress,
  onPressIn,
  onPressOut,
  ...props
}: SmoothPressableProps) {
  const { reduceMotion } = useAccessibilityPreferences();
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * 0.08,
    transform: [{ scale: 1 - pressed.value * 0.025 }],
  }));

  return (
    <Animated.View style={[containerStyle, animatedStyle]}>
      <Pressable
        {...props}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
        hitSlop={hitSlop}
        style={style}
        onPress={(event) => {
          if (haptic) tapLight();
          onPress?.(event);
        }}
        onPressIn={(event) => {
          pressed.value = reduceMotion ? 0 : withTiming(1, { duration: 90 });
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressed.value = reduceMotion ? 0 : withTiming(0, { duration: 140 });
          onPressOut?.(event);
        }}
      />
    </Animated.View>
  );
}
