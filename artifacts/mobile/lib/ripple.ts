// Android touch feedback.
//
// Opacity-only presses read as dead on Android, where every tappable is
// expected to ripple. The config is themed and centralized so surfaces don't
// each invent a ripple color.
//
// Ripple does not follow `borderRadius` on its own: a bounded ripple needs
// `overflow: "hidden"` on the pressable, and an icon-only control should use
// `borderless` with an explicit radius instead.

import { Platform, type PressableAndroidRippleConfig } from "react-native";

import { withAlpha } from "@/lib/contrast";

const RIPPLE_OPACITY = 0.12;

export function androidRipple(
  color: string,
  options: { borderless?: boolean; radius?: number } = {},
): PressableAndroidRippleConfig | undefined {
  if (Platform.OS !== "android") return undefined;
  return {
    color: withAlpha(color, RIPPLE_OPACITY),
    borderless: options.borderless ?? false,
    radius: options.radius,
    foreground: !options.borderless,
  };
}
