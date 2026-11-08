import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";

import { BRAND_BASE_DARK } from "@/constants/brand";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { canRevealLaunch, launchTiming } from "@/lib/launchTransition";
import { BubbleHouseMark } from "./HouseLoader";

// Native splash, font loading, and this overlay share one fixed background.
// Destination screens mount underneath; no second logo or measured-logo handoff
// can flash or prevent the application from becoming visible.
export function HouseTransition({
  loading,
  children,
  onLaunchStateChange,
}: {
  loading: boolean;
  children: React.ReactNode;
  onLaunchStateChange?: (pending: boolean) => void;
}) {
  const { reduceMotion } = useAccessibilityPreferences();
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [assemblyComplete, setAssemblyComplete] = useState(false);
  const [destinationLaidOut, setDestinationLaidOut] = useState(false);
  const [layoutWaitMs, setLayoutWaitMs] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  const opacity = useSharedValue(1);
  const revealing = useRef(false);
  const nativeSplashHidden = useRef(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const finish = useCallback(() => {
    if (loadingRef.current || cycleRef.current !== cycle) return;
    setOverlayVisible(false);
    onLaunchStateChange?.(false);
  }, [onLaunchStateChange, cycle]);
  const onAssembled = useCallback(() => {
    if (cycleRef.current === cycle) setAssemblyComplete(true);
  }, [cycle]);

  useEffect(() => {
    if (!surfaceReady || nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, [surfaceReady]);

  useEffect(() => {
    if (!loading) return;
    cancelAnimation(opacity);
    opacity.value = 1;
    revealing.current = false;
    setOverlayVisible(true);
    setAssemblyComplete(false);
    setDestinationLaidOut(false);
    setLayoutWaitMs(0);
    setCycle((value) => value + 1);
    onLaunchStateChange?.(true);
  }, [loading, opacity, onLaunchStateChange]);

  useEffect(() => {
    if (loading || destinationLaidOut) return;
    const fallbackMs = launchTiming(reduceMotion).layoutFallbackMs;
    const timer = setTimeout(() => setLayoutWaitMs(fallbackMs), fallbackMs);
    return () => clearTimeout(timer);
  }, [loading, destinationLaidOut, reduceMotion]);

  useEffect(() => {
    if (
      !surfaceReady ||
      !overlayVisible ||
      revealing.current ||
      !canRevealLaunch({
        loading,
        assemblyComplete,
        destinationLaidOut,
        layoutWaitMs,
      })
    )
      return;
    revealing.current = true;
    opacity.value = withTiming(
      0,
      {
        duration: launchTiming(reduceMotion).revealMs,
        easing: Easing.inOut(Easing.ease),
      },
      (finished) => {
        if (finished) runOnJS(finish)();
      },
    );
  }, [
    surfaceReady,
    overlayVisible,
    loading,
    assemblyComplete,
    destinationLaidOut,
    layoutWaitMs,
    reduceMotion,
    opacity,
    finish,
  ]);

  useEffect(() => () => cancelAnimation(opacity), [opacity]);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.root} onLayout={() => setSurfaceReady(true)}>
      {!loading && (
        <View
          style={styles.content}
          pointerEvents={overlayVisible ? "none" : "auto"}
          aria-hidden={overlayVisible}
          accessibilityElementsHidden={overlayVisible}
          importantForAccessibility={
            overlayVisible ? "no-hide-descendants" : "auto"
          }
          onLayout={() => setDestinationLaidOut(true)}
        >
          {children}
        </View>
      )}
      {(loading || overlayVisible) && (
        <Animated.View
          style={[styles.overlay, overlayStyle]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading SweetMate"
        >
          {surfaceReady && (
            <BubbleHouseMark key={cycle} onComplete={onAssembled} />
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND_BASE_DARK },
  content: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND_BASE_DARK,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
});
