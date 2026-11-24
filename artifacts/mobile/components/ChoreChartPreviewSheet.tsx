import React, { useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoreChartApprovalSuccess } from "@/components/ChoreChartApprovalSuccess";
import { ChartApprovalStatus } from "@/components/ChartApprovalStatus";
import { ChoreChartPreview } from "@/components/ChoreChartPreview";
import { GlassActionBar } from "@/components/GlassActionBar";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import type { ChartApproval, Chore, ProposedChart, Roommate } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";

export function ChoreChartPreviewSheet({ visible, payload, members, chores, now, householdId, timezone, chartId, approvals, currentUserId, approved, sendForApproval = false, sent = false, approvalSuccess = false, busy, blocked, notice, error, onApprove, onBack, onSuccessComplete }: {
  visible: boolean;
  payload: ProposedChart["payload"] | null;
  members: Roommate[];
  chores: Chore[];
  now: Date;
  householdId: string;
  timezone: string;
  chartId: string | null;
  approvals: ChartApproval[];
  currentUserId: string;
  approved: boolean;
  sendForApproval?: boolean;
  sent?: boolean;
  approvalSuccess?: boolean;
  onSuccessComplete: () => void;
  busy: boolean;
  blocked: boolean;
  notice: string;
  error: string | null;
  onApprove: () => void;
  onBack: () => void;
}) {
  const colors = useTheme();
  const [actionHeight, setActionHeight] = useState(80);
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const actionComplete = sendForApproval ? sent : approved;
  const actionLabel = sendForApproval ? sent ? "Sent for approval" : "Send for approval" : approved ? "Approved" : "Approve";
  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent animationType={reduceMotion ? "none" : "fade"} onRequestClose={approvalSuccess ? onSuccessComplete : onBack}>
      <View style={styles.overlay}>
        <GlassModalBackdrop />
        <GlassModalSurface style={[styles.sheet, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16), paddingLeft: Math.max(insets.left, 20), paddingRight: Math.max(insets.right, 20) }]}>
          {approvalSuccess ? <ChoreChartApprovalSuccess onComplete={onSuccessComplete} /> : <>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Chore chart preview</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: actionHeight + 24 }]} showsVerticalScrollIndicator>
            <ChartApprovalStatus chartId={chartId} members={members} approvals={approvals} currentUserId={currentUserId} />
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{notice}</Text>
            {payload && <ChoreChartPreview embedded payload={payload} members={members} chores={chores} now={now} householdId={householdId} timezone={timezone} />}
          </ScrollView>
          <GlassActionBar onLayout={({ nativeEvent }) => setActionHeight(nativeEvent.layout.height)} style={[styles.actionBar, { bottom: Math.max(insets.bottom, 16), left: Math.max(insets.left, 20), right: Math.max(insets.right, 20) }]} >
          {error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error}</Text>}
          <View style={styles.actions}>
            <GlassButton tone="neutral" disabled={busy} onPress={onBack} accessibilityLabel="Back to chore chart creator" style={styles.button}>
              <Text style={[styles.buttonText, { color: colors.foreground }]}>Back</Text>
            </GlassButton>
            <GlassButton disabled={busy || blocked || actionComplete} onPress={onApprove} accessibilityLabel={sendForApproval ? actionLabel : approved ? "Chore chart approved" : "Approve chore chart"} accessibilityState={{ busy }} style={styles.button}>
              {busy ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.buttonText, { color: colors.actionForeground }]}>{actionLabel}</Text>}
            </GlassButton>
          </View>
          </GlassActionBar>
          </>}
        </GlassModalSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: { flex: 1, width: "100%", borderWidth: 0, borderRadius: 0, gap: 16 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22 },
  scroll: { flex: 1 },
  content: { gap: 16, paddingBottom: 8 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  actionBar: { position: "absolute" },
  actions: { flexDirection: "row", gap: 12 },
  button: { flex: 1, borderRadius: 12 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
