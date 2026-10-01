// Single source for the floating tab bar's geometry.
//
// The bar is absolutely positioned, so nothing reserves space for it: every
// scroll view has to pad its own content past it. Android makes that worse —
// edge-to-edge is mandatory from SDK 54 / Android 16, so the bar also has to
// clear a gesture pill (~24pt) or a 3-button nav bar (~48pt) that the old
// fixed 90pt padding did not account for.

import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const TAB_BAR_HEIGHT = 68;
const TAB_BAR_WEB_BOTTOM = 12;
const TAB_BAR_NATIVE_MIN_BOTTOM = 8;
const CONTENT_GAP = 16;

export interface TabBarLayout {
  /** Gap between the screen bottom and the bar itself. */
  tabBarBottom: number;
  /** Height of everything the bar occupies, measured from the screen bottom. */
  tabBarInset: number;
  /** Bottom padding a scroll view needs so its last row clears the bar. */
  contentBottomPadding: number;
}

export function useTabBarLayout(): TabBarLayout {
  const insets = useSafeAreaInsets();
  const tabBarBottom =
    Platform.OS === "web"
      ? TAB_BAR_WEB_BOTTOM
      : Math.max(insets.bottom, TAB_BAR_NATIVE_MIN_BOTTOM);
  const tabBarInset = tabBarBottom + TAB_BAR_HEIGHT;

  return {
    tabBarBottom,
    tabBarInset,
    contentBottomPadding: tabBarInset + CONTENT_GAP,
  };
}
