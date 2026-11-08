import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { useTheme } from "@/constants/colors";
import { HouseTransitionContext } from "./HouseTransitionContext";
import { BrandMark } from "./BrandMark";

export type Target = { x: number; y: number; size: number };


// The destination supplies geometry, never a second visible house. Keeping this
// above the auth branches preserves the SVG while session/data state changes.
export function HouseTransition({ loading, hasHouse, children }: { loading: boolean; hasHouse: boolean; children: React.ReactNode }) {
  const colors = useTheme();
  const root = useRef<View>(null);
  const [laidOut, setLaidOut] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [destinationLaidOut, setDestinationLaidOut] = useState(false);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reveal = useSharedValue(0);
  const pulse = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);
  const report = useCallback((next: Target) => setTarget(next), []);

  useEffect(() => {
    if (!laidOut) return;
    // Hide the native splash only after the stationary SVG has a native layout.
    void SplashScreen.hideAsync().catch(() => {});
  }, [laidOut]);

  useEffect(() => {
    if (!laidOut || loading || !destinationLaidOut || (hasHouse && !target)) return;
    root.current?.measureInWindow((rootX, rootY) => {
      const timing = { duration: 250, easing: Easing.inOut(Easing.ease) };
      reveal.value = withTiming(1, timing);
      if (hasHouse && target) {
        x.value = withTiming(target.x - rootX + target.size / 2 - 112, timing);
        y.value = withTiming(target.y - rootY + target.size / 2 - 112, timing);
        scale.value = withTiming(target.size / 224, timing);
        opacity.value = 1;
      } else {
        opacity.value = withTiming(0, timing);
      }
    });
  }, [laidOut, loading, hasHouse, destinationLaidOut, target, x, y, scale, opacity, reveal]);

  useEffect(() => {
    if (loading) {
      root.current?.measureInWindow((_rootX, _rootY, width, height) => {
        x.value = (width - 224) / 2;
        y.value = (height - 224) / 2;
        scale.value = 1;
      });
      setTarget(null);
      setDestinationLaidOut(false);
      reveal.value = 0;
      opacity.value = 1;
    }
  }, [loading, reveal, opacity, x, y, scale]);

  // Breathing pulse while loading; settles back to rest over the same 250ms as
  // the handoff so the house lands on its target at exactly its final size.
  useEffect(() => {
    const ease = { duration: 850, easing: Easing.inOut(Easing.ease) };
    if (loading) {
      pulse.value = withRepeat(withSequence(withTiming(1.06, ease), withTiming(1, ease)), -1, false);
      pulseOpacity.value = withRepeat(withSequence(withTiming(1, ease), withTiming(0.78, ease)), -1, false);
    } else {
      cancelAnimation(pulse);
      cancelAnimation(pulseOpacity);
      const settle = { duration: 250, easing: Easing.inOut(Easing.ease) };
      pulse.value = withTiming(1, settle);
      pulseOpacity.value = withTiming(1, settle);
    }
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(pulseOpacity);
    };
  }, [loading, pulse, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulse.value }],
  }));
  const houseStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

  return (
    <View ref={root} style={{ flex: 1, backgroundColor: colors.background }} onLayout={(event) => {
      if (!laidOut) {
        x.value = (event.nativeEvent.layout.width - 224) / 2;
        y.value = (event.nativeEvent.layout.height - 224) / 2;
        setLaidOut(true);
      }
    }}>
      <HouseTransitionContext.Provider value={report}>
        {!loading && <Animated.View style={[{ flex: 1 }, contentStyle]} onLayout={() => setDestinationLaidOut(true)}>{children}</Animated.View>}
      </HouseTransitionContext.Provider>
      <Animated.View pointerEvents="none" style={[styles.house, houseStyle]}>
        <Animated.View style={pulseStyle}>
          <BrandMark size={224} color={colors.primary} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ house: { position: "absolute", left: 0, top: 0, width: 224, height: 224 } });
