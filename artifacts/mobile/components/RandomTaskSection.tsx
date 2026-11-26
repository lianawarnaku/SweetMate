import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { Surface } from "@/components/Surface";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { error as hapticError, success as hapticSuccess } from "@/lib/haptics";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { randomTaskClaimTime, unclaimedRandomTasks, type RandomTask, type RandomTaskInput, type RandomTaskMode } from "@/lib/randomTasks";
import type { Chore, Roommate } from "@/context/AppContext";

const MODES: { value: RandomTaskMode; title: string; detail: string; icon: "clock" | "shuffle" }[] = [
  { value: "up-for-grabs", title: "Up for grabs", detail: "Anyone can claim it within 24 hours. Then it’s randomly assigned.", icon: "clock" },
  { value: "random", title: "Randomly assign", detail: "Choose someone from the household at random now.", icon: "shuffle" },
];

export function RandomTaskSection({ tasks, roommates, chores, currentUserId, timezone, ready, loading, error, now, onRefresh, onCreate, onClaim, onOpenChore }: {
  tasks: RandomTask[]; roommates: Roommate[]; chores: Chore[]; currentUserId: string; timezone: string;
  ready: boolean; loading: boolean; error: string | null; now: number;
  onRefresh: () => Promise<unknown>; onCreate: (input: RandomTaskInput) => Promise<void>;
  onClaim: (taskId: string) => Promise<void>; onOpenChore: (chore: Chore) => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [draft, setDraft] = useState<RandomTaskInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const busy = useRef(false);
  const sorted = unclaimedRandomTasks(tasks);
  const visibleTasks = showAll ? sorted : sorted.slice(0, 6);
  const close = () => { if (!busy.current) { setDraft(null); setFormError(null); } };
  const create = async () => {
    if (!draft || busy.current) return;
    if (!draft.title.trim()) { setFormError("Enter a task name."); return; }
    busy.current = true;
    setSaving(true);
    setFormError(null);
    try { await onCreate(draft); setDraft(null); hapticSuccess(); }
    catch (failure) { setFormError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "This task could not be added. Try again."); hapticError(); }
    finally { busy.current = false; setSaving(false); }
  };
  const claim = async (taskId: string) => {
    if (busy.current) return;
    busy.current = true;
    setClaiming(taskId);
    setClaimError(null);
    try { await onClaim(taskId); hapticSuccess(); }
    catch (failure) { setClaimError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "This task could not be claimed. Try again."); hapticError(); }
    finally { busy.current = false; setClaiming(null); }
  };
  return <View style={styles.section}>
    <View style={styles.header}>
      <Feather name="shuffle" size={17} color={colors.mutedForeground} />
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>Random Task</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add a random task" disabled={!ready || saving || Boolean(claiming)}
        onPress={() => { setDraft({ id: Crypto.randomUUID(), title: "", mode: "up-for-grabs" }); setFormError(null); }}
        style={[styles.add, { opacity: ready ? 1 : 0.5 }]}>
        <Feather name="plus" size={17} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground }]}>Add task</Text>
      </TouchableOpacity>
    </View>
    {!ready && loading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 12 }} /> : null}
    {visibleTasks.map((task) => {
      const chore = task.choreId ? chores.find((item) => item.id === task.choreId) : null;
      const completed = chore?.completed ?? task.completed;
      const assigneeId = chore?.assignedTo || task.assignedTo;
      const member = roommates.find((person) => person.id === assigneeId);
      const name = member?.id === currentUserId ? "you" : member?.name ?? "a Sweetmate";
      const open = !task.assignedAt;
      const expired = open && Boolean(task.claimDeadline && Date.parse(task.claimDeadline) <= now);
      return <Surface key={task.id} style={styles.task}>
        <Text style={[styles.taskTitle, { color: colors.foreground, textDecorationLine: completed ? "line-through" : "none" }]}>{chore?.title ?? task.title}</Text>
        {open ? <>
          <View style={styles.statusRow}><Text style={[styles.meta, { color: colors.mutedForeground }]}>Up for grabs</Text></View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{randomTaskClaimTime(task, now)}</Text>
          <GlassButton tone="neutral" disabled={expired || Boolean(claiming) || saving} accessibilityLabel={`Claim ${task.title}`} accessibilityState={{ busy: claiming === task.id }}
            onPress={() => void claim(task.id)} style={styles.claim}>
            {claiming === task.id ? <ActivityIndicator color={colors.foreground} /> : <Text style={[styles.buttonText, { color: colors.foreground }]}>{expired ? "Assigning…" : "Claim task"}</Text>}
          </GlassButton>
        </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View ${task.title}, ${completed ? "completed" : `assigned to ${name}`}`} disabled={!chore}
          onPress={() => { if (chore) onOpenChore(chore); }} style={styles.assignee}>
          {member && <RoommateAvatar name={member.name} color={member.color} size={28} imageUri={member.avatarUri} />}
          <View style={styles.copy}>
            <Text style={[styles.meta, { color: colors.foreground }]}>{completed ? "Completed" : `${task.assignmentKind === "claimed" ? "Claimed by" : "Randomly assigned to"} ${name}`}</Text>
            {!completed && task.dueAt && <Text style={[styles.meta, { color: colors.mutedForeground }]}>Due {new Date(chore?.dueDate ?? task.dueAt).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>}
          </View>
          <Feather name={completed ? "check-circle" : "chevron-right"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>}
      </Surface>;
    })}
    {sorted.length > 6 && <TouchableOpacity accessibilityRole="button" onPress={() => setShowAll((value) => !value)} style={styles.more}>
      <Text style={[styles.meta, { color: colors.mutedForeground, textDecorationLine: "underline" }]}>{showAll ? "Show less" : `See all ${sorted.length} tasks`}</Text>
    </TouchableOpacity>}
    {(error || claimError) && <View style={{ gap: 4 }}>
      <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{claimError || error}</Text>
      {error && <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => { void onRefresh().catch(() => {}); }} style={styles.more}><Text style={[styles.meta, { color: colors.foreground, textDecorationLine: "underline" }]}>Try again</Text></TouchableOpacity>}
    </View>}
    <Modal visible={draft !== null} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <GlassModalBackdrop onPress={close} accessibilityLabel="Cancel random task" />
        <GlassModalSurface style={styles.sheet}>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.foreground }]}>Random Task</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }} style={{ flexShrink: 1 }}>
            <TextInput accessibilityLabel="Random task name" value={draft?.title ?? ""} placeholder="What needs doing?" placeholderTextColor={colors.mutedForeground}
              onChangeText={(title) => setDraft((value) => value ? { ...value, title } : null)} editable={!saving} maxLength={120} autoFocus
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]} />
            <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
              {MODES.map((mode) => {
                const selected = draft?.mode === mode.value;
                const foreground = selected ? colors.actionForeground : colors.foreground;
                return <GlassButton key={mode.value} tone={selected ? "primary" : "neutral"} disabled={saving} accessibilityRole="radio"
                  accessibilityLabel={`${mode.title}. ${mode.detail}`} accessibilityState={{ checked: selected }}
                  onPress={() => setDraft((value) => value ? { ...value, mode: mode.value } : null)} style={styles.mode}>
                  <View style={styles.modeContent}>
                    <Feather name={mode.icon} size={18} color={foreground} />
                    <View style={styles.copy}><Text style={[styles.buttonText, { color: foreground }]}>{mode.title}</Text><Text style={[styles.meta, { color: foreground }]}>{mode.detail}</Text></View>
                    <Feather name={selected ? "check-circle" : "circle"} size={18} color={foreground} />
                  </View>
                </GlassButton>;
              })}
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Everyone in your household, including you, can be selected. Tasks are due 24 hours after they’re claimed or assigned.</Text>
            {formError && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{formError}</Text>}
          </ScrollView>
          <View style={styles.actions}>
            <GlassButton tone="neutral" disabled={saving} onPress={close} style={styles.action}><Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text></GlassButton>
            <GlassButton disabled={saving || !draft?.title.trim()} onPress={() => void create()} accessibilityState={{ busy: saving }} style={styles.action}>
              {saving ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.buttonText, { color: colors.actionForeground }]}>Add task</Text>}
            </GlassButton>
          </View>
        </GlassModalSurface>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 12, gap: 10 },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 17 },
  add: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 8 },
  task: { padding: 16, borderRadius: 18, gap: 8 },
  taskTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  claim: { alignSelf: "flex-start", borderRadius: 10, marginTop: 2 },
  assignee: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  more: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", borderRadius: 24, padding: 20, gap: 18 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 21 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 16 },
  mode: { borderRadius: 14, minHeight: 88 },
  modeContent: { width: "100%", flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 10 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, borderRadius: 12 },
});
