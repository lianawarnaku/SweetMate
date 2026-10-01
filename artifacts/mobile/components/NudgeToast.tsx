import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";
import { shouldDismissNudge, visibleNudges } from "@/lib/nudgeDisplay";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

export function NudgeToast() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { currentUserId, nudges, nudgesReady, acknowledgeNudge, dismissNudge } =
    useAppContextSelector((context) => ({
      currentUserId: context.currentUserId,
      nudges: context.nudges,
      nudgesReady: context.nudgesReady,
      acknowledgeNudge: context.acknowledgeNudge,
      dismissNudge: context.dismissNudge,
    }));
  const queue = useMemo(
    () => visibleNudges(nudges, currentUserId),
    [currentUserId, nudges],
  );
  const current = queue[0];
  const translateX = useRef(new Animated.Value(0)).current;
  const dismissingRef = useRef(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    translateX.setValue(0);
    dismissingRef.current = false;
    setDismissingId(null);
    setError(null);
  }, [current?.id, translateX]);

  useEffect(() => {
    if (current && !current.seen) {
      void acknowledgeNudge(current.id).catch((cause) => {
        reportRuntimeError("mark nudge seen", cause, { nudgeId: current.id });
      });
    }
  }, [acknowledgeNudge, current?.id, current?.seen]);

  useEffect(() => {
    if (current) {
      AccessibilityInfo.announceForAccessibility(
        "You received a nudge. Someone in your Sweet sent you a reminder.",
      );
    }
  }, [current?.id]);

  const persistDismissal = useCallback(async (nudgeId: string) => {
    setError(null);
    try {
      await dismissNudge(nudgeId);
    } catch (cause) {
      dismissingRef.current = false;
      setDismissingId(null);
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      setError("Couldn’t dismiss. Try again.");
      reportRuntimeError("dismiss nudge", cause, { nudgeId });
    }
  }, [dismissNudge, translateX]);

  const animateDismissal = useCallback((nudgeId: string, direction: number) => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setDismissingId(nudgeId);
    setError(null);
    Animated.timing(translateX, {
      toValue: direction * 500,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        void persistDismissal(nudgeId);
      } else {
        dismissingRef.current = false;
        setDismissingId(null);
      }
    });
  }, [persistDismissal, translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
        onPanResponderMove: (_, gesture) => translateX.setValue(gesture.dx),
        onPanResponderRelease: (_, gesture) => {
          if (shouldDismissNudge(gesture.dx, gesture.vx * 1000)) {
            if (current) {
              animateDismissal(current.id, gesture.dx < 0 ? -1 : 1);
            }
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [animateDismissal, current?.id, translateX],
  );

  if (!nudgesReady || !current) return null;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.toast,
        {
          top: insets.top + 10,
          backgroundColor: colors.foreground,
          shadowColor: colors.foreground,
          transform: [{ translateX }],
        },
      ]}
    >
      <View style={styles.content} {...panResponder.panHandlers}>
        <Text style={[styles.title, { color: colors.background }]}>
          You received a nudge
        </Text>
        <Text style={[styles.copy, { color: colors.background }]}>
          Someone in your Sweet sent you a reminder.
          {queue.length > 1 ? ` ${queue.length - 1} more waiting.` : ""}
        </Text>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss nudge"
        accessibilityHint="Removes this nudge"
        disabled={dismissingId === current.id}
        hitSlop={8}
        style={({ pressed }) => [
          styles.dismissButton,
          pressed && styles.dismissButtonPressed,
        ]}
        onPress={(event) => {
          event.stopPropagation();
          animateDismissal(current.id, 1);
        }}
      >
        <Feather name="x" size={21} color={colors.background} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 1000,
    borderRadius: 14,
    paddingLeft: 15,
    paddingRight: 6,
    paddingVertical: 8,
    opacity: 0.96,
    elevation: 8,
    shadowOpacity: Platform.OS === "ios" ? 0.18 : 0,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    flexDirection: "row",
    alignItems: "center",
  },
  content: { flex: 1, paddingVertical: 3 },
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },
  copy: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 2 },
  error: { color: "#FECACA", fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12, marginTop: 3 },
  dismissButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    zIndex: 1,
  },
  dismissButtonPressed: { opacity: 0.55 },
});
