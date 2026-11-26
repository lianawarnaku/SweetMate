import { Feather } from "@expo/vector-icons";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  InteractionManager,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { useTabBarLayout } from "@/hooks/useTabBarLayout";

import { useTheme } from "@/constants/colors";
import { isLeaderboardVisible } from "@/constants/featureAvailability";
import { useAppContextSelector } from "@/context/AppContext";
import { useAppPopup } from "@/components/AppPopupProvider";
import { APP_TABS, isAppTabId, tabAfterHiding } from "@/lib/tabVisibility";
import { GlassTabBar } from "@/components/LiquidGlass";
import { SmoothPressable } from "@/components/SmoothPressable";
import { clampTabIndicatorX, resolveDraggedTabIndex } from "@/lib/tabBarGesture";
import { tapLight } from "@/lib/haptics";

const TAB_GESTURE_HOLD_MS = 260;
const TAB_MENU_HOLD_MS = 600;
const TAB_MENU_MOVE_TOLERANCE = 8;

function ScrollableTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useTheme();
  const pointsEnabled = useAppContextSelector(
    (context) => context.pointsEnabled,
  );
  const hiddenTabs = useAppContextSelector((context) => context.hiddenTabs);
  const setTabHidden = useAppContextSelector((context) => context.setTabHidden);
  const { showPopup } = useAppPopup();
  const { tabBarBottom } = useTabBarLayout();
  // Expo Router auto-registers every route file, even when its Tabs.Screen
  // configuration is conditionally omitted. Remove the route from the array
  // we actually render so it creates neither a button nor a flex slot.
  const visibleRoutes = useMemo(
    () =>
      state.routes.filter(
        (route) => (isLeaderboardVisible(pointsEnabled) || route.name !== "leaderboard") &&
          (!isAppTabId(route.name) || !hiddenTabs.includes(route.name)),
      ),
    [hiddenTabs, pointsEnabled, state.routes],
  );
  const focusedRouteKey = state.routes[state.index]?.key;
  const preloadedRouteKeys = useRef(new Set<string>());
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const [contentWidth, setContentWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const bubbleActivity = useRef(new Animated.Value(0)).current;
  const indicatorXValue = useRef(0);
  const dragStartX = useRef(0);
  const dragActive = useRef(false);
  const draggedIndex = useRef(-1);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressConsumed = useRef(false);
  const longPressedTabKey = useRef<string | null>(null);
  const animationVersion = useRef(0);
  const animationRunning = useRef(false);
  const targetX = useRef(0);
  const previousGeometry = useRef({ width: 0, count: 0, reduceMotion });
  const focusedVisibleIndex = visibleRoutes.findIndex((route) => route.key === focusedRouteKey);
  const tabWidth = contentWidth > 0 ? contentWidth / visibleRoutes.length : 0;
  const boundedIndicatorX = useMemo(
    () => indicatorX.interpolate({
      inputRange: [0, Math.max(1, tabWidth * (visibleRoutes.length - 1))],
      outputRange: [0, Math.max(1, tabWidth * (visibleRoutes.length - 1))],
      extrapolate: "clamp",
    }),
    [indicatorX, tabWidth, visibleRoutes.length],
  );

  const clearHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (menuTimer.current) clearTimeout(menuTimer.current);
    holdTimer.current = null;
    menuTimer.current = null;
  }, []);

  useEffect(() => {
    const listener = indicatorX.addListener(({ value }) => {
      indicatorXValue.current = value;
    });
    return () => indicatorX.removeListener(listener);
  }, [indicatorX]);

  const settleIndicator = useCallback((index: number, animate = true) => {
    if (!tabWidth) return;
    const destination = clampTabIndicatorX(
      index * tabWidth, tabWidth, visibleRoutes.length,
    );
    if (animate && !reduceMotion && animationRunning.current && targetX.current === destination) return;
    const version = ++animationVersion.current;
    targetX.current = destination;
    animationRunning.current = false;
    indicatorX.stopAnimation();
    bubbleActivity.stopAnimation();

    if (reduceMotion || !animate) {
      indicatorX.setValue(destination);
      indicatorXValue.current = destination;
      bubbleActivity.setValue(0);
      return;
    }
    const shrink = () => {
      if (version !== animationVersion.current || dragActive.current) return;
      Animated.spring(bubbleActivity, {
        toValue: 0,
        damping: 16,
        stiffness: 260,
        mass: 0.65,
        overshootClamping: true,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && version === animationVersion.current) animationRunning.current = false;
      });
    };
    animationRunning.current = true;
    if (Math.abs(indicatorXValue.current - destination) < 0.5) {
      indicatorX.setValue(destination);
      indicatorXValue.current = destination;
      shrink();
      return;
    }
    Animated.timing(bubbleActivity, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
    Animated.spring(indicatorX, {
      toValue: destination,
      damping: 22,
      stiffness: 240,
      mass: 0.72,
      overshootClamping: true,
      restDisplacementThreshold: 0.15,
      restSpeedThreshold: 0.15,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) shrink();
    });
  }, [bubbleActivity, indicatorX, reduceMotion, tabWidth, visibleRoutes.length]);

  useEffect(() => {
    if (!tabWidth) return;
    const previous = previousGeometry.current;
    const geometryChanged = previous.width !== tabWidth ||
      previous.count !== visibleRoutes.length || previous.reduceMotion !== reduceMotion;
    previousGeometry.current = { width: tabWidth, count: visibleRoutes.length, reduceMotion };
    if (geometryChanged) {
      clearHold();
      dragActive.current = false;
      settleIndicator(focusedVisibleIndex, false);
    } else if (!dragActive.current) {
      settleIndicator(focusedVisibleIndex);
    }
  }, [clearHold, focusedVisibleIndex, reduceMotion, settleIndicator, tabWidth, visibleRoutes.length]);

  useEffect(() => () => {
    clearHold();
    animationVersion.current += 1;
    indicatorX.stopAnimation();
    bubbleActivity.stopAnimation();
  }, [bubbleActivity, clearHold, indicatorX]);

  const navigateToVisibleIndex = (index: number) => {
    const route = visibleRoutes[index];
    if (!route) return focusedVisibleIndex;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (event.defaultPrevented) return focusedVisibleIndex;
    if (route.key !== focusedRouteKey) navigation.navigate(route.name, route.params);
    return index;
  };

  const requestHideTab = useCallback((name: string) => {
    if (!isAppTabId(name)) return;
    const label = APP_TABS.find((tab) => tab.id === name)!.label;
    if (visibleRoutes.length <= 1) {
      showPopup({
        title: "Keep one tab visible",
        message: "Restore another tab in Settings → App Preferences → App Appearance before hiding this one.",
        icon: "eye",
        actions: [{ label: "Got it" }],
      });
      return;
    }
    showPopup({
      title: `Hide ${label}?`,
      message: "You can restore this tab in Settings → App Preferences → App Appearance.",
      icon: "eye-off",
      actions: [
        { label: "Hide tab", primary: true, onPress: () => {
          if (!setTabHidden(name, true)) {
            throw new Error("Keep at least one tab visible. Restore another tab in App Appearance first.");
          }
          const currentState = navigation.getState();
          if (currentState.routes[currentState.index]?.name === name) {
            const next = tabAfterHiding(visibleRoutes, name);
            if (next) navigation.navigate(next.name, next.params);
          }
        } },
        { label: "Cancel" },
      ],
    });
  }, [navigation, setTabHidden, showPopup, visibleRoutes]);

  const indicatorPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          clearHold();
          longPressConsumed.current = false;
          const version = ++animationVersion.current;
          animationRunning.current = false;
          dragStartX.current = indicatorXValue.current;
          indicatorX.stopAnimation((value) => {
            if (version !== animationVersion.current) return;
            indicatorXValue.current = value;
            dragStartX.current = clampTabIndicatorX(value, tabWidth, visibleRoutes.length);
          });
          bubbleActivity.stopAnimation();
          dragActive.current = false;
          draggedIndex.current = focusedVisibleIndex;
          holdTimer.current = setTimeout(() => {
            if (version !== animationVersion.current) return;
            dragActive.current = true;
            if (!reduceMotion) {
              Animated.timing(bubbleActivity, {
                toValue: 1, duration: 100, useNativeDriver: true,
              }).start();
            }
            tapLight();
          }, TAB_GESTURE_HOLD_MS);
          // The selected icon has a gesture overlay. A stationary hold opens
          // its menu; moving before this deadline keeps hold-and-slide intact.
          menuTimer.current = setTimeout(() => {
            if (version !== animationVersion.current) return;
            clearHold();
            longPressConsumed.current = true;
            dragActive.current = false;
            settleIndicator(focusedVisibleIndex);
            const route = visibleRoutes[focusedVisibleIndex];
            if (route) {
              navigation.emit({ type: "tabLongPress", target: route.key });
              requestHideTab(route.name);
            }
          }, TAB_MENU_HOLD_MS);
        },
        onPanResponderMove: (_event, gesture) => {
          if (Math.abs(gesture.dx) > TAB_MENU_MOVE_TOLERANCE || Math.abs(gesture.dy) > TAB_MENU_MOVE_TOLERANCE) {
            if (menuTimer.current) clearTimeout(menuTimer.current);
            menuTimer.current = null;
          }
          if (longPressConsumed.current || !dragActive.current || !tabWidth) return;
          const nextX = clampTabIndicatorX(
            dragStartX.current + gesture.dx, tabWidth, visibleRoutes.length,
          );
          indicatorX.setValue(nextX);
          const nextIndex = resolveDraggedTabIndex(nextX, tabWidth, visibleRoutes.length);
          if (nextIndex !== draggedIndex.current) {
            draggedIndex.current = nextIndex;
            tapLight();
          }
        },
        onPanResponderRelease: () => {
          clearHold();
          if (longPressConsumed.current) {
            dragActive.current = false;
            settleIndicator(focusedVisibleIndex);
            return;
          }
          const wasDragging = dragActive.current;
          dragActive.current = false;
          const index = wasDragging ? draggedIndex.current : focusedVisibleIndex;
          // Always snap and shrink, even for same-tab or prevented navigation.
          settleIndicator(navigateToVisibleIndex(index));
        },
        onPanResponderTerminate: () => {
          clearHold();
          dragActive.current = false;
          settleIndicator(focusedVisibleIndex);
        },
      }),
    // Recreate the responder when route geometry changes so its closures match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bubbleActivity, clearHold, focusedRouteKey, focusedVisibleIndex, indicatorX, navigation, reduceMotion, requestHideTab, settleIndicator, tabWidth, visibleRoutes],
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const interaction = InteractionManager.runAfterInteractions(() => {
      visibleRoutes.forEach((route, index) => {
        if (
          route.key === focusedRouteKey ||
          preloadedRouteKeys.current.has(route.key)
        ) {
          return;
        }
        timers.push(
          setTimeout(() => {
            navigation.preload(route.name, route.params);
            preloadedRouteKeys.current.add(route.key);
          }, index * 45),
        );
      });
    });
    return () => {
      interaction.cancel();
      timers.forEach(clearTimeout);
    };
  }, [focusedRouteKey, navigation, visibleRoutes]);

  return (
    <GlassTabBar
      style={[
        styles.tabBarShell,
        {
          bottom: tabBarBottom,
          borderColor: colors.glassRim,
          shadowColor: "#000000",
        },
        Platform.OS === "web" && !reduceTransparency ? styles.webFrost : undefined,
      ]}
    >
      <View
        style={styles.tabBarContent}
        onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
      >
        {tabWidth > 0 && focusedVisibleIndex >= 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.selectionFrame,
                { width: tabWidth, transform: [{ translateX: boundedIndicatorX }] },
              ]}
            >
              <Animated.View
                style={[
                  styles.selectionBubble,
                  {
                    backgroundColor: colors.action,
                    transform: [
                      { scaleX: bubbleActivity.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1], extrapolate: "clamp" }) },
                      { scaleY: bubbleActivity.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1], extrapolate: "clamp" }) },
                    ],
                  },
                ]}
              />
            </Animated.View>
            <Animated.View
              testID="selected-tab-gesture"
              accessible={false}
              accessibilityElementsHidden={true}
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.selectionGestureTarget,
                {
                  width: tabWidth,
                  transform: [{ translateX: boundedIndicatorX }],
                },
              ]}
              {...indicatorPanResponder.panHandlers}
            />
          </>
        )}
        {visibleRoutes.map((route) => {
          const { options } = descriptors[route.key];
          const focused = focusedRouteKey === route.key;
          const color = focused ? colors.actionForeground : colors.mutedForeground;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string"
                ? options.title
                : route.name;

          const onPress = () => {
            if (longPressedTabKey.current === route.key) {
              longPressedTabKey.current = null;
              return;
            }
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <SmoothPressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              aria-selected={focused}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityHint={`${focused ? "Currently selected. " : ""}Hold to hide, or hold and slide the selected tab to switch tabs`}
              accessibilityActions={[{ name: "hide", label: `Hide ${label} tab` }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "hide") requestHideTab(route.name);
              }}
              onPressIn={() => { longPressedTabKey.current = null; }}
              onPress={onPress}
              delayLongPress={TAB_MENU_HOLD_MS}
              onLongPress={() => {
                longPressedTabKey.current = route.key;
                navigation.emit({ type: "tabLongPress", target: route.key });
                requestHideTab(route.name);
              }}
              containerStyle={styles.tabItemSlot}
              style={styles.tabItem}
            >
              <View style={styles.iconSlot}>
                {options.tabBarIcon?.({ focused, color, size: 21 })}
              </View>
              <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </SmoothPressable>
          );
        })}
      </View>
    </GlassTabBar>
  );
}

export default function TabLayout() {
  const colors = useTheme();
  const pointsEnabled = useAppContextSelector(
    (context) => context.pointsEnabled,
  );

  return (
    <Tabs
      tabBar={(props) => <ScrollableTabBar {...props} />}
      detachInactiveScreens={false}
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        // Without this the scene wrapper defaults to a white background,
        // which flashes through during the fade transition between tabs.
        sceneStyle: { backgroundColor: colors.background },
        // Keep the first frame light, then ScrollableTabBar preloads the other
        // routes after interactions. Once mounted, tabs stay live so an edit
        // is not paid as a queued rerender on the next focus.
        lazy: true,
        freezeOnBlur: false,
        animation: "fade",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "My Sweet",
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="group"
        options={{
          title: "Group",
          tabBarIcon: ({ color }) => (
            <Feather name="users" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: "Expenses",
          tabBarIcon: ({ color }) => (
            <Feather name="dollar-sign" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: "Shopping",
          tabBarIcon: ({ color }) => (
            <Feather name="shopping-cart" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="borrow"
        options={{
          title: "Borrow",
          tabBarIcon: ({ color }) => (
            <Feather name="repeat" size={19} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: "Ranks",
          href: isLeaderboardVisible(pointsEnabled) ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Feather name="award" size={21} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  webFrost: { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as ViewStyle,
  tabBarShell: {
    position: "absolute",
    left: 14,
    right: 14,
    height: 68,
    borderRadius: 28,
    overflow: "hidden",
    elevation: 12,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  tabBarContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingVertical: 6,
  },
  selectionFrame: {
    position: "absolute",
    left: 0,
    top: 6,
    height: 54,
  },
  selectionBubble: { flex: 1, borderRadius: 21 },
  selectionGestureTarget: {
    position: "absolute",
    zIndex: 3,
    left: 0,
    top: 6,
    height: 54,
    borderRadius: 21,
  },
  tabItemSlot: { flex: 1, height: 54 },
  tabItem: {
    zIndex: 2,
    flex: 1,
    width: "100%",
    height: 54,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    overflow: "hidden",
  },
  iconSlot: {
    width: 28,
    height: 23,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tabLabel: { fontSize: 10, lineHeight: 12, fontFamily: "Inter_500Medium" },
});
