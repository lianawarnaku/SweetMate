import { Feather } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  InteractionManager,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";
import { SmoothPressable } from "@/components/SmoothPressable";
import { clampTabIndicatorX, resolveDraggedTabIndex } from "@/lib/tabBarGesture";
import { tapLight } from "@/lib/haptics";

const TAB_GESTURE_HOLD_MS = 260;

function ScrollableTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useTheme();
  const pointsEnabled = useAppContextSelector(
    (context) => context.pointsEnabled,
  );
  const colorScheme = useAppContextSelector((context) => context.colorScheme);
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  // Expo Router auto-registers every route file, even when its Tabs.Screen
  // configuration is conditionally omitted. Remove the route from the array
  // we actually render so it creates neither a button nor a flex slot.
  const visibleRoutes = useMemo(
    () =>
      state.routes.filter(
        (route) => pointsEnabled || route.name !== "leaderboard",
      ),
    [pointsEnabled, state.routes],
  );
  const focusedRouteKey = state.routes[state.index]?.key;
  const preloadedRouteKeys = useRef(new Set<string>());
  const [contentWidth, setContentWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorXValue = useRef(0);
  const dragStartX = useRef(0);
  const dragActive = useRef(false);
  const draggedIndex = useRef(-1);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedVisibleIndex = Math.max(
    0,
    visibleRoutes.findIndex((route) => route.key === focusedRouteKey),
  );
  const tabWidth = contentWidth > 0 ? contentWidth / visibleRoutes.length : 0;

  useEffect(() => {
    const listener = indicatorX.addListener(({ value }) => {
      indicatorXValue.current = value;
    });
    return () => indicatorX.removeListener(listener);
  }, [indicatorX]);

  useEffect(() => {
    if (!tabWidth || dragActive.current) return;
    Animated.spring(indicatorX, {
      toValue: focusedVisibleIndex * tabWidth,
      damping: 22,
      stiffness: 240,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [focusedVisibleIndex, indicatorX, tabWidth]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const navigateToVisibleIndex = (index: number) => {
    const route = visibleRoutes[index];
    if (!route) return;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (route.key !== focusedRouteKey && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  const indicatorPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartX.current = indicatorXValue.current;
          dragActive.current = false;
          draggedIndex.current = focusedVisibleIndex;
          holdTimer.current = setTimeout(() => {
            dragActive.current = true;
            tapLight();
          }, TAB_GESTURE_HOLD_MS);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!dragActive.current || !tabWidth) return;
          const nextX = clampTabIndicatorX(
            dragStartX.current + gesture.dx,
            tabWidth,
            visibleRoutes.length,
          );
          indicatorX.setValue(nextX);
          const nextIndex = resolveDraggedTabIndex(
            nextX,
            tabWidth,
            visibleRoutes.length,
          );
          if (nextIndex !== draggedIndex.current) {
            draggedIndex.current = nextIndex;
            tapLight();
          }
        },
        onPanResponderRelease: () => {
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = null;
          const wasDragging = dragActive.current;
          dragActive.current = false;
          if (wasDragging) {
            navigateToVisibleIndex(draggedIndex.current);
          } else {
            navigateToVisibleIndex(focusedVisibleIndex);
            Animated.spring(indicatorX, {
              toValue: focusedVisibleIndex * tabWidth,
              damping: 22,
              stiffness: 240,
              mass: 0.72,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = null;
          dragActive.current = false;
          Animated.spring(indicatorX, {
            toValue: focusedVisibleIndex * tabWidth,
            damping: 22,
            stiffness: 240,
            mass: 0.72,
            useNativeDriver: true,
          }).start();
        },
      }),
    // Recreate the responder when route geometry changes so its closures match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedRouteKey, focusedVisibleIndex, indicatorX, navigation, tabWidth, visibleRoutes],
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
    <View
      style={[
        styles.tabBarShell,
        {
          bottom: isWeb ? 12 : Math.max(insets.bottom, 8),
          borderColor: colors.border,
        },
      ]}
    >
      <BlurView
        intensity={68}
        tint={colorScheme === "mono" ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          colorScheme === "mono" ? styles.darkGlassTint : styles.lightGlassTint,
        ]}
      />
      <View
        style={styles.tabBarContent}
        onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
      >
        {tabWidth > 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.selectionBubble,
                {
                  width: tabWidth,
                  backgroundColor:
                    colorScheme === "mono"
                      ? "rgba(255,255,255,0.14)"
                      : "rgba(29,25,27,0.11)",
                  transform: [{ translateX: indicatorX }],
                },
              ]}
            />
            <Animated.View
              accessibilityLabel="Drag to switch tabs"
              accessibilityHint="Press and hold, then slide left or right"
              style={[
                styles.selectionGestureTarget,
                {
                  width: tabWidth,
                  transform: [{ translateX: indicatorX }],
                },
              ]}
              {...indicatorPanResponder.panHandlers}
            />
          </>
        )}
        {visibleRoutes.map((route) => {
          const { options } = descriptors[route.key];
          const focused = focusedRouteKey === route.key;
          const color = focused ? colors.primary : colors.mutedForeground;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string"
                ? options.title
                : route.name;

          const onPress = () => {
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
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityHint={focused ? `${label} tab, currently selected` : `Switch to the ${label} tab`}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
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
    </View>
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
      {pointsEnabled && (
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: "Ranks",
            tabBarIcon: ({ color }) => (
              <Feather name="award" size={21} color={color} />
            ),
          }}
        />
      )}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarShell: {
    position: "absolute",
    left: 14,
    right: 14,
    height: 68,
    borderWidth: 1,
    borderRadius: 28,
    overflow: "hidden",
    elevation: 12,
    shadowColor: "#3D2B20",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  lightGlassTint: { backgroundColor: "rgba(255, 252, 247, 0.64)" },
  darkGlassTint: { backgroundColor: "rgba(8, 8, 10, 0.62)" },
  tabBarContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingVertical: 6,
  },
  selectionBubble: {
    position: "absolute",
    left: 0,
    top: 6,
    height: 54,
    borderRadius: 21,
  },
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
