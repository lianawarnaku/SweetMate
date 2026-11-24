import React, { useCallback, useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { success } from "@/lib/haptics";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LENGTH = 64;

/** Mounted only after this user's approval request succeeds. */
export function ChoreChartApprovalSuccess({ onComplete }: { onComplete: () => void }) {
  const colors = useTheme();
  const { reduceMotion } = useAccessibilityPreferences();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const alive = useRef(false);
  const finished = useRef(false);
  const hapticPlayed = useRef(false);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.76);
  const stroke = useSharedValue(CHECK_LENGTH);
  const halo = useSharedValue(reduceMotion ? 1 : 0);
  const copy = useSharedValue(reduceMotion ? 1 : 0);
  const finish = useCallback(() => {
    if (!alive.current || finished.current) return;
    finished.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    alive.current = true;
    opacity.value = reduceMotion ? 1 : 0;
    scale.value = reduceMotion ? 1 : 0.76;
    stroke.value = reduceMotion ? 0 : CHECK_LENGTH;
    halo.value = reduceMotion ? 1 : 0;
    copy.value = reduceMotion ? 1 : 0;
    if (!hapticPlayed.current) {
      hapticPlayed.current = true;
      success();
    }
    if (!reduceMotion) {
      opacity.value = withTiming(1, { duration: 140 });
      scale.value = withSequence(
        withTiming(1.06, { duration: 220, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { duration: 260, dampingRatio: 0.72 }),
      );
      stroke.value = withDelay(100, withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
      halo.value = withDelay(180, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
      copy.value = withDelay(180, withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }));
    }
    const timer = setTimeout(() => {
      if (reduceMotion) finish();
      else opacity.value = withTiming(0, { duration: 160 }, (complete) => { if (complete) runOnJS(finish)(); });
    }, reduceMotion ? 1100 : 1250);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      [opacity, scale, stroke, halo, copy].forEach(cancelAnimation);
    };
  }, [reduceMotion, opacity, scale, stroke, halo, copy, finish]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: (1 - halo.value) * 0.18, transform: [{ scale: 0.92 + halo.value * 0.38 }] }));
  const copyStyle = useAnimatedStyle(() => ({ opacity: copy.value, transform: [{ translateY: (1 - copy.value) * 8 }] }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: stroke.value }));

  return <Animated.View style={[styles.screen, screenStyle]}>
    <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Approval saved. Return to My Sweet" accessibilityHint="Returns automatically, or tap to continue now" style={styles.continueArea}>
      <View style={styles.markContainer} accessible={false}>
        <Animated.View style={[styles.halo, { backgroundColor: colors.action }, haloStyle]} />
        <Animated.View style={[styles.mark, { backgroundColor: colors.action }, markStyle]}>
          <Svg width={72} height={72} viewBox="0 0 64 64" accessible={false}>
            <AnimatedPath animatedProps={checkProps} d="M15 33 L27 45 L50 20" fill="none" stroke={colors.actionForeground} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]} />
          </Svg>
        </Animated.View>
      </View>
      <Animated.View style={[styles.copy, copyStyle]} accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Approved!</Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>Your approval has been saved.</Text>
        <Text style={[styles.returnLabel, { color: colors.mutedForeground }]}>Returning to My Sweet…</Text>
      </Animated.View>
    </Pressable>
  </Animated.View>;
}

export function ChoreChartApprovalSuccessModal({ visible, onComplete }: { visible: boolean; onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  return <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent animationType={reduceMotion ? "none" : "fade"} onRequestClose={onComplete}>
    <View style={styles.overlay}>
      <GlassModalBackdrop />
      <GlassModalSurface style={[styles.surface, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {visible && <ChoreChartApprovalSuccess onComplete={onComplete} />}
      </GlassModalSurface>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  surface: { flex: 1, borderRadius: 0, borderWidth: 0 },
  screen: { flex: 1 },
  continueArea: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  markContainer: { width: 176, height: 176, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  halo: { position: "absolute", width: 140, height: 140, borderRadius: 70 },
  mark: { width: 124, height: 124, borderRadius: 62, alignItems: "center", justifyContent: "center" },
  copy: { alignItems: "center", gap: 10, maxWidth: 360 },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, textAlign: "center" },
  message: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 23, textAlign: "center" },
  returnLabel: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginTop: 12, textAlign: "center" },
});
