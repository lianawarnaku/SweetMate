import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { frequencyLabel, type ChartPayload } from "@/lib/choreChart";

export function ChoreAssignmentPreferencesSheet({ visible, payload, members, currentUserId, busy, blocked, onChange, onClose }: {
  visible: boolean;
  payload: ChartPayload | null;
  members: Array<{ id: string; name: string }>;
  currentUserId: string;
  busy: boolean;
  blocked?: string | null;
  onChange: (taskId: string, kind: "always" | "never") => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!visible) setError(null); }, [visible]);
  const close = () => { if (!busy) onClose(); };
  const change = (taskId: string, kind: "always" | "never") => {
    if (blocked) return;
    setError(null);
    try { onChange(taskId, kind); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "This preference could not be changed. Please try again."); }
  };
  return <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
    <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <GlassModalBackdrop onPress={close} accessibilityLabel="Close permanent task preferences" />
      <GlassModalSurface style={styles.sheet}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Permanent task preferences</Text>
          <GlassButton tone="neutral" disabled={busy} onPress={close} accessibilityLabel="Close permanent task preferences" style={{ width: 44 }}>
            <Feather name="x" size={18} color={colors.foreground} />
          </GlassButton>
        </View>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>Always me makes you the permanent owner. Never me excludes you from this task. Changes rebuild an unsent preview; send it for approval to return everyone to Pending.</Text>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 16 }}>
          {(payload?.generatedTasks ?? []).map((task) => {
            const manual = payload?.manualAssignmentTaskIds?.includes(task.id);
            const pin = payload?.pinnedAssignments?.[task.id];
            const always = pin === currentUserId;
            const never = payload?.excludedAssignments?.[task.id]?.includes(currentUserId) ?? false;
            return <View key={task.id} style={[styles.task, { borderBottomColor: colors.border }]}>
              <Text style={[styles.taskName, { color: colors.foreground }]}>{task.title}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{task.difficulty}/5 difficulty · {frequencyLabel(task.frequency)} · {task.timeOfDay}</Text>
              {always && <Text style={[styles.meta, { color: colors.foreground }]}>You are the permanent owner</Text>}
              {never && <Text style={[styles.meta, { color: colors.foreground }]}>You are excluded from this task</Text>}
              {pin && !always && <Text style={[styles.meta, { color: colors.mutedForeground }]}>Permanent owner: {members.find((member) => member.id === pin)?.name ?? "Sweetmate"}</Text>}
              {manual ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>Edit this manual assignment in Group.</Text> : <View style={styles.buttons}>
                <GlassButton tone={always ? "primary" : "neutral"} disabled={busy || Boolean(blocked)} accessibilityLabel={`Always assign ${task.title} to me`} accessibilityState={{ selected: always }} onPress={() => change(task.id, "always")} style={styles.ruleButton}>
                  <Text style={[styles.buttonText, { color: always ? colors.actionForeground : colors.foreground }]}>Always me</Text>
                </GlassButton>
                <GlassButton tone={never ? "primary" : "neutral"} disabled={busy || Boolean(blocked)} accessibilityLabel={`Never assign ${task.title} to me`} accessibilityState={{ selected: never }} onPress={() => change(task.id, "never")} style={styles.ruleButton}>
                  <Text style={[styles.buttonText, { color: never ? colors.actionForeground : colors.foreground }]}>Never me</Text>
                </GlassButton>
              </View>}
            </View>;
          })}
          {(blocked || error) && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{blocked || error}</Text>}
        </ScrollView>
        <GlassButton disabled={busy} onPress={close} style={{ borderRadius: 12 }} accessibilityLabel="Done editing task preferences">
          <Text style={[styles.buttonText, { color: colors.actionForeground }]}>Done</Text>
        </GlassButton>
      </GlassModalSurface>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", borderRadius: 24, padding: 20, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  task: { gap: 6, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  taskName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  ruleButton: { flex: 1, minWidth: 100, borderRadius: 12 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
