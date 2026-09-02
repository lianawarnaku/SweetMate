import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { SmoothPressable } from "@/components/SmoothPressable";
import { useTheme } from "@/constants/colors";
import { buildInviteMessage } from "@/lib/invite";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

type InviteCodeCardProps = {
  inviteCode: string | null;
  loading?: boolean;
  onRetry?: () => void;
  compact?: boolean;
};

export function InviteCodeCard({
  inviteCode,
  loading = false,
  onRetry,
  compact = false,
}: InviteCodeCardProps) {
  const colors = useTheme();
  const [status, setStatus] = useState<string | null>(null);
  const clearStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
    },
    [],
  );

  const showStatus = (message: string) => {
    setStatus(message);
    AccessibilityInfo.announceForAccessibility(message);
    if (clearStatusTimer.current) clearTimeout(clearStatusTimer.current);
    clearStatusTimer.current = setTimeout(() => setStatus(null), 2200);
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await Clipboard.setStringAsync(inviteCode);
      showStatus("Code copied");
    } catch (error) {
      reportRuntimeError("copy household invite code", error);
      showStatus("Couldn’t copy the code. Try again.");
    }
  };

  const shareInvite = async () => {
    if (!inviteCode) return;
    try {
      await Share.share({
        title: "Join my Sweet on SweetMate",
        message: buildInviteMessage(inviteCode),
      });
    } catch (error) {
      reportRuntimeError("share household invite", error);
      showStatus("Couldn’t open sharing. Try again.");
    }
  };

  return (
    <View
      style={[
        styles.card,
        compact && styles.compactCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "14" }]}>
          <Feather name="user-plus" size={19} color={colors.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Invite Sweetmates</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            Send this private code to someone you want to join your Sweet.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.stateRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Loading invite code…</Text>
        </View>
      ) : inviteCode ? (
        <>
          <Text
            accessibilityLabel={`Invite code ${inviteCode.split("").join(" ")}`}
            selectable
            style={[styles.code, { color: colors.foreground, backgroundColor: colors.muted }]}
          >
            {inviteCode}
          </Text>
          <View style={styles.actions}>
            <SmoothPressable
              accessibilityRole="button"
              accessibilityLabel="Copy invite code"
              accessibilityHint="Copies the household invite code to your clipboard"
              onPress={copyCode}
              containerStyle={styles.actionSlot}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Feather name="copy" size={17} color={colors.primary} />
              <Text style={[styles.secondaryText, { color: colors.foreground }]}>Copy code</Text>
            </SmoothPressable>
            <SmoothPressable
              accessibilityRole="button"
              accessibilityLabel="Share invite with Sweetmates"
              accessibilityHint="Opens your device sharing options with an invitation message"
              onPress={shareInvite}
              containerStyle={styles.actionSlot}
              style={[styles.primaryButton, { backgroundColor: colors.action, borderColor: colors.primary }]}
            >
              <Feather name="send" size={17} color={colors.actionForeground} />
              <Text style={[styles.primaryText, { color: colors.actionForeground }]}>Share invite</Text>
            </SmoothPressable>
          </View>
        </>
      ) : (
        <View style={styles.missingState}>
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Your invite code couldn’t be loaded.
          </Text>
          {onRetry ? (
            <SmoothPressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
              <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
            </SmoothPressable>
          ) : null}
        </View>
      )}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.primary }]}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, borderWidth: 1, borderRadius: 22, padding: 18, gap: 14 },
  compactCard: { marginHorizontal: 0, borderWidth: 0, padding: 0 },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  headingCopy: { flex: 1, gap: 3 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  description: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 19 },
  code: {
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 12,
    textAlign: "center",
    fontFamily: "Inter_700Bold",
    fontSize: 27,
    letterSpacing: 4,
  },
  actions: { flexDirection: "row", gap: 10 },
  actionSlot: { flex: 1 },
  primaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  secondaryText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  stateRow: { minHeight: 70, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  stateText: { fontFamily: "Inter_400Regular", fontSize: 14 },
  missingState: { alignItems: "center", gap: 4, paddingVertical: 10 },
  retryButton: { minHeight: 40, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  retryText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  status: { textAlign: "center", fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
