import React, { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";
import { saveFeedback } from "@/lib/saveFeedback";

export function SaveFeedbackNotice({
  scope,
  onlyKey,
  inline = false,
}: {
  scope: string;
  onlyKey?: string;
  inline?: boolean;
}) {
  const colors = useTheme();
  const snapshot = useSyncExternalStore(
    saveFeedback.subscribe,
    saveFeedback.getSnapshot,
    saveFeedback.getSnapshot,
  );
  const issues =
    snapshot.scope === scope
      ? snapshot.issues.filter((issue) =>
          onlyKey
            ? issue.key === onlyKey
            : !snapshot.inlineKeys.includes(issue.key),
        )
      : [];
  useEffect(() => {
    if (!inline || !onlyKey) return;
    saveFeedback.showInline(scope, onlyKey, true);
    return () => saveFeedback.showInline(scope, onlyKey, false);
  }, [scope, onlyKey, inline]);
  const failed = issues.filter((issue) => issue.phase === "failed");
  const pending = issues.some((issue) => issue.phase === "pending");
  const [showPending, setShowPending] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShowPending(false);
      return;
    }
    // Keep fast saves from flashing a loader over the immediate check animation.
    const timer = setTimeout(() => setShowPending(true), 300);
    return () => clearTimeout(timer);
  }, [pending, scope]);
  if (!failed.length && !(pending && showPending)) return null;
  const labels = [...new Set(failed.map((issue) => issue.label))];
  const message =
    failed.length === 1 && failed[0].failureMessage
      ? failed[0].failureMessage
      : failed.length
        ? `Save not confirmed · ${labels.join(", ")}`
        : "Saving changes…";
  return (
    <View
      testID="save-feedback-notice"
      style={[
        styles.notice,
        { backgroundColor: colors.card, borderColor: colors.border },
        inline && styles.inline,
      ]}
    >
      <View style={styles.copy}>
        <Text
          accessibilityRole={failed.length ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          style={[
            styles.message,
            {
              color: failed.length
                ? colors.destructive
                : colors.mutedForeground,
            },
          ]}
        >
          {message}
        </Text>
        {failed.length > 0 && pending && (
          <Text style={[styles.secondary, { color: colors.mutedForeground }]}>
            Other changes are saving…
          </Text>
        )}
      </View>
      {failed.length > 0 && (
        <GlassButton
          tone="neutral"
          accessibilityLabel="Retry failed saves"
          onPress={() => void saveFeedback.retry(scope, onlyKey)}
          style={styles.retry}
        >
          <Text style={[styles.retryText, { color: colors.foreground }]}>
            Retry
          </Text>
        </GlassButton>
      )}
    </View>
  );
}
export function AppSaveFeedback() {
  const { userId, householdId } = useAppContextSelector((context) => ({
    userId: context.currentUserId,
    householdId: context.householdId,
  }));
  const scope = userId && householdId ? `${userId}:${householdId}` : "";
  const insets = useSafeAreaInsets(),
    path = usePathname();
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void saveFeedback.retry(scope);
    });
    return () => listener.remove();
  }, [scope]);
  const tab = [
    "/",
    "/group",
    "/shopping",
    "/expenses",
    "/borrow",
    "/points",
  ].includes(path);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.position,
        { bottom: insets.bottom + (tab ? 88 : 12), right: tab ? 88 : 16 },
      ]}
    >
      <SaveFeedbackNotice scope={scope} />
    </View>
  );
}
const styles = StyleSheet.create({
  position: { position: "absolute", left: 16, right: 16, zIndex: 1100 },
  notice: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inline: { maxWidth: undefined },
  copy: { flex: 1, minWidth: 0 },
  message: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  secondary: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  retry: {
    minWidth: 64,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  retryText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
