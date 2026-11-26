import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { useTheme } from "@/constants/colors";
import type { GeneratedTask } from "@/context/AppContext";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { frequencyLabel } from "@/lib/choreChart";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";

type Settings = Pick<GeneratedTask, "title" | "difficulty" | "frequency">;
const FREQUENCIES: GeneratedTask["frequency"][] = ["daily", "everyOtherDay", "everyThreeDays", "weekly", "biweekly", "monthly"];

export function GeneratedTasksSheet({ visible, tasks, onClose, onSave }: {
  visible: boolean;
  tasks: GeneratedTask[];
  onClose: () => void;
  onSave: (taskId: string, settings: Settings) => Promise<void>;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [draft, setDraft] = useState<(Settings & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!visible) { setDraft(null); setError(null); }
  }, [visible]);

  const close = () => {
    if (savingRef.current) return;
    if (draft) { setDraft(null); setError(null); }
    else onClose();
  };
  const save = async () => {
    if (!draft || savingRef.current) return;
    if (!draft.title.trim()) { setError("Enter a chore name."); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.id, { title: draft.title.trim(), difficulty: draft.difficulty, frequency: draft.frequency });
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your changes could not be saved. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <GlassModalBackdrop onPress={close} accessibilityLabel={draft ? "Cancel editing generated chore" : "Close generated tasks"} />
        <GlassModalSurface style={styles.sheet}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{draft ? "Edit generated task" : "Current generated tasks"}</Text>
            <GlassButton tone="neutral" disabled={saving} onPress={close} accessibilityLabel={draft ? "Cancel editing generated chore" : "Close generated tasks"} style={{ width: 44 }}>
              <Feather name={draft ? "chevron-left" : "x"} size={20} color={colors.foreground} />
            </GlassButton>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
            {draft ? <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>CHORE NAME</Text>
              <TextInput
                accessibilityLabel="Generated chore name"
                value={draft.title}
                onChangeText={(title) => setDraft((current) => current ? { ...current, title } : null)}
                editable={!saving} maxLength={120}
                style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
              />
              <Text style={[styles.label, { color: colors.mutedForeground }]}>DIFFICULTY</Text>
              <View accessibilityRole="radiogroup" style={styles.row}>
                {([1, 2, 3, 4, 5] as const).map((difficulty) => <GlassButton
                  key={difficulty} disabled={saving} tone={draft.difficulty === difficulty ? "primary" : "neutral"}
                  accessibilityRole="radio" accessibilityState={{ checked: draft.difficulty === difficulty }}
                  aria-checked={draft.difficulty === difficulty} accessibilityLabel={`Difficulty ${difficulty} of 5`}
                  onPress={() => setDraft((current) => current ? { ...current, difficulty } : null)} style={{ flex: 1, borderRadius: 10 }}
                >
                  <Text style={[styles.buttonText, { color: draft.difficulty === difficulty ? colors.actionForeground : colors.foreground }]}>{difficulty}</Text>
                </GlassButton>)}
              </View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>FREQUENCY</Text>
              <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: "wrap" }]}>
                {FREQUENCIES.map((frequency) => <GlassButton
                  key={frequency} disabled={saving} tone={draft.frequency === frequency ? "primary" : "neutral"}
                  accessibilityRole="radio" accessibilityState={{ checked: draft.frequency === frequency }}
                  aria-checked={draft.frequency === frequency} accessibilityLabel={frequencyLabel(frequency)}
                  onPress={() => setDraft((current) => current ? { ...current, frequency } : null)} style={{ borderRadius: 10, maxWidth: "100%" }}
                >
                  <Text style={[styles.buttonText, { flexShrink: 1, color: draft.frequency === frequency ? colors.actionForeground : colors.foreground }]}>{frequencyLabel(frequency)}</Text>
                </GlassButton>)}
              </View>
            </> : tasks.length ? tasks.map((task) => <View key={task.id} style={[styles.taskRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Text style={[styles.taskName, { color: colors.foreground }]}>{task.title}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>Difficulty {task.difficulty}/5 · {frequencyLabel(task.frequency)}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`} style={styles.editButton} onPress={() => { setDraft({ id: task.id, title: task.title, difficulty: task.difficulty, frequency: task.frequency }); setError(null); }}>
                <Text style={[styles.buttonText, { color: colors.foreground, textDecorationLine: "underline" }]}>Edit</Text>
              </TouchableOpacity>
            </View>) : <Text style={[styles.meta, { color: colors.mutedForeground }]}>No automatic chores match your current household setup.</Text>}
            {error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error}</Text>}
          </ScrollView>
          {draft ? <View style={styles.row}>
            <GlassButton tone="neutral" disabled={saving} onPress={close} style={{ flex: 1, borderRadius: 12 }}><Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text></GlassButton>
            <GlassButton disabled={saving || !draft.title.trim()} onPress={() => void save()} accessibilityLabel="Save generated chore changes" accessibilityState={{ busy: saving }} style={{ flex: 1, borderRadius: 12 }}>
              {saving ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.buttonText, { color: colors.actionForeground }]}>Save changes</Text>}
            </GlassButton>
          </View> : <GlassButton onPress={onClose} style={{ borderRadius: 12 }}><Text style={[styles.buttonText, { color: colors.actionForeground }]}>Done</Text></GlassButton>}
        </GlassModalSurface>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", padding: 20, borderRadius: 24, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 20 },
  row: { flexDirection: "row", gap: 8 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 15 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  taskName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 13, textAlign: "center" },
  editButton: { minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
});
