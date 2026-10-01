// Keyboard avoidance behaves differently per platform.
//
// iOS wants `padding`. On Android the window is resized by the system, but
// under edge-to-edge (mandatory from SDK 54) that resize no longer accounts
// for the keyboard on every OEM, so `height` is the reliable choice — and
// `undefined`, which this app used everywhere, means no avoidance at all.

import { Platform } from "react-native";
import type { KeyboardAvoidingViewProps } from "react-native";

export const KEYBOARD_BEHAVIOR: KeyboardAvoidingViewProps["behavior"] =
  Platform.select({ ios: "padding", android: "height" });
