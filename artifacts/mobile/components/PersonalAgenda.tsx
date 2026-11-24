import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { Surface } from "@/components/Surface";
import { GlassCheckCircle } from "@/components/GlassCheckCircle";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { householdDueDate } from "@/lib/choreTimezone";
import { scheduleDateKey, scheduleItemPeriod, scheduleItemProgress, scheduleItemTimes, scheduleItemsForDay, scheduleTimeLabel, type PersonalScheduleItem, type TaskScheduleUpdate } from "@/lib/personalSchedule";
import type { Chore } from "@/context/AppContext";

function ScheduleRing({ item, now }: { item: PersonalScheduleItem; now: number }) {
  const colors = useTheme();
  const progress = scheduleItemProgress(item, now);
  if (!progress) return null;
  const minutes = Math.ceil(progress.remainingMs / 60000);
  const circumference = 2 * Math.PI * 20;
  return <View accessible accessibilityLabel={`In progress, ${minutes} minutes remaining`} style={styles.ring}>
    <Svg width={48} height={48} style={{ position: "absolute" }}>
      <Circle cx={24} cy={24} r={20} fill="none" stroke={colors.border} strokeWidth={3} />
      <Circle cx={24} cy={24} r={20} fill="none" stroke={colors.foreground} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress.elapsed)} rotation={-90} origin="24,24" />
    </Svg>
    <Text style={[styles.ringText, { color: colors.foreground }]}>{minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`}</Text>
  </View>;
}

export function PersonalAgenda({ items, chores, day, timezone, renderChore, onUpdateTask }: {
  items: PersonalScheduleItem[]; chores: Chore[]; day: string; timezone: string;
  renderChore: (chore: Chore) => React.ReactNode; onUpdateTask: (id: string, update: TaskScheduleUpdate) => Promise<void>;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [now, setNow] = useState(Date.now);
  const [editing, setEditing] = useState<PersonalScheduleItem | null>(null);
  const [period, setPeriod] = useState<"morning" | "night">("morning");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const working = useRef(false);
  const visible = scheduleItemsForDay(items, day, timezone).filter((item) => !item.app_completed_at || scheduleDateKey(new Date(item.app_completed_at), timezone) === day);
  const active = visible.some((item) => scheduleItemProgress(item, now));
  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = setInterval(update, active ? 1000 : 15000);
    const boundaries = visible.flatMap((item) => { const time = scheduleItemTimes(item); return [time.start, time.end].flatMap((stamp) => stamp && Date.parse(stamp) > Date.now() ? [Date.parse(stamp)] : []); });
    const next = boundaries.length ? setTimeout(update, Math.min(2_147_483_647, Math.max(10, Math.min(...boundaries) - Date.now() + 10))) : null;
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(interval); if (next) clearTimeout(next); listener.remove(); };
  }, [active, items, day, timezone]);
  const update = async (item: PersonalScheduleItem, value: TaskScheduleUpdate) => {
    if (working.current) return;
    working.current = true; setUpdating(item.id); setError(null);
    try { await onUpdateTask(item.id, value); }
    catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "This task could not be updated."); }
    finally { working.current = false; setUpdating(null); }
  };
  const edit = (item: PersonalScheduleItem) => {
    setEditing(item); setPeriod(scheduleItemPeriod(item, timezone, day)); setError(null);
    const clock = (stamp: string | null) => stamp ? new Date(stamp).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
    setStart(clock(item.override_start)); setEnd(clock(item.override_end));
  };
  const close = () => { if (!saving) { setEditing(null); setError(null); } };
  const save = async () => {
    if (!editing || working.current) return;
    const valid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if ((start || end) && (!valid(start) || !valid(end) || end <= start)) { setError("Use HH:MM (24-hour time), with the end after the start."); return; }
    const stamp = (value: string) => householdDueDate(day, Number(value.slice(0, 2)), timezone, Number(value.slice(3, 5)));
    working.current = true; setSaving(true); setError(null);
    try { await onUpdateTask(editing.id, { period, ...(start && end ? { start: stamp(start), end: stamp(end) } : { clearTime: true }) }); setEditing(null); }
    catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "This task could not be scheduled."); }
    finally { working.current = false; setSaving(false); }
  };
  return <View>
    {(["morning", "night"] as const).map((part) => {
      const dayChores = chores.filter((chore) => (chore.timeOfDay === "night" ? "night" : "morning") === part);
      const personal = visible.filter((item) => scheduleItemPeriod(item, timezone, day) === part).sort((a, b) => {
        if (Boolean(a.app_completed_at) !== Boolean(b.app_completed_at)) return a.app_completed_at ? 1 : -1;
        return (scheduleItemTimes(a).start ?? "z").localeCompare(scheduleItemTimes(b).start ?? "z") || a.title.localeCompare(b.title);
      });
      return <View key={part} style={styles.period}>
        <View style={styles.periodTitle}><Feather name={part === "morning" ? "sunrise" : "moon"} size={17} color={colors.mutedForeground} /><Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>{part === "morning" ? "Morning" : "Night"}</Text></View>
        {dayChores.map((chore) => <React.Fragment key={chore.id}>{renderChore(chore)}</React.Fragment>)}
        {personal.map((item) => <Surface key={item.id} style={styles.event}>
          <View style={styles.row}>
            {item.source === "google-task" ? <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={`Complete in SweetMate: ${item.title}`} aria-checked={Boolean(item.app_completed_at)} accessibilityState={{ checked: Boolean(item.app_completed_at), busy: updating === item.id }}
              disabled={Boolean(updating) || saving} onPress={() => void update(item, { completed: !item.app_completed_at })} style={styles.check}>
              {updating === item.id ? <ActivityIndicator color={colors.foreground} /> : <GlassCheckCircle size={22} state={item.app_completed_at ? "checked" : "idle"} />}
            </TouchableOpacity> : <Feather name="calendar" size={19} color={colors.mutedForeground} />}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.source === "google-task" ? `Schedule ${item.title}` : `Open ${item.title} in Google Calendar`}
              style={styles.copy} onPress={() => { if (item.source === "google-task") edit(item); else if (item.link) void Linking.openURL(item.link).catch(() => setError("This Google event could not open.")); }}>
              <Text style={[styles.title, { color: colors.foreground, textDecorationLine: item.app_completed_at ? "line-through" : "none" }]}>{item.title}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{scheduleTimeLabel(item, timezone)}</Text>
              {scheduleItemProgress(item, now) && <Text style={[styles.live, { color: colors.foreground }]}>Happening now</Text>}
            </TouchableOpacity>
            <ScheduleRing item={item} now={now} />
          </View>
        </Surface>)}
        {!dayChores.length && !personal.length && <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing planned</Text>}
      </View>;
    })}
    {error && !editing && <Text accessibilityRole="alert" style={[styles.message, { color: colors.destructive }]}>{error}</Text>}
    <Modal visible={editing !== null} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <GlassModalBackdrop onPress={close} accessibilityLabel="Cancel task schedule" />
        <GlassModalSurface style={styles.sheet}>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.foreground }]}>{editing?.title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
            <View accessibilityRole="radiogroup" style={styles.row}>
              {(["morning", "night"] as const).map((value) => <GlassButton key={value} tone={period === value ? "primary" : "neutral"} disabled={saving} accessibilityRole="radio" aria-checked={period === value} accessibilityState={{ checked: period === value }} onPress={() => { setPeriod(value); setStart(""); setEnd(""); }} style={{ flex: 1, borderRadius: 12 }}>
                <Text style={[styles.title, { color: period === value ? colors.actionForeground : colors.foreground }]}>{value === "morning" ? "Morning" : "Night"}</Text>
              </GlassButton>)}
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Optional time block · 24-hour time</Text>
            <View style={styles.row}>
              <View style={styles.copy}><Text style={[styles.meta, { color: colors.mutedForeground }]}>Start</Text><TextInput accessibilityLabel="Task start time, HH:MM" value={start} onChangeText={setStart} placeholder="09:00" placeholderTextColor={colors.mutedForeground} editable={!saving} maxLength={5} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]} /></View>
              <View style={styles.copy}><Text style={[styles.meta, { color: colors.mutedForeground }]}>End</Text><TextInput accessibilityLabel="Task end time, HH:MM" value={end} onChangeText={setEnd} placeholder="10:00" placeholderTextColor={colors.mutedForeground} editable={!saving} maxLength={5} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]} /></View>
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Task checkmarks and added times are saved in SweetMate.</Text>
            {error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error}</Text>}
          </ScrollView>
          <View style={styles.row}><GlassButton tone="neutral" disabled={saving} onPress={close} style={styles.button}><Text style={[styles.title, { color: colors.foreground }]}>Cancel</Text></GlassButton><GlassButton disabled={saving} onPress={() => void save()} style={styles.button}>{saving ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.title, { color: colors.actionForeground }]}>Save</Text>}</GlassButton></View>
        </GlassModalSurface>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  period: { gap: 8, paddingBottom: 16 }, periodTitle: { marginHorizontal: 16, minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 }, heading: { fontFamily: "Inter_700Bold", fontSize: 17 },
  event: { marginHorizontal: 16, marginBottom: 4, padding: 14, borderRadius: 18 }, row: { flexDirection: "row", alignItems: "center", gap: 10 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 14 }, meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }, live: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  check: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 }, ring: { width: 48, height: 48, justifyContent: "center", alignItems: "center" }, ringText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  empty: { marginHorizontal: 16, fontFamily: "Inter_400Regular", fontSize: 13, paddingBottom: 8 }, message: { marginHorizontal: 16, fontFamily: "Inter_400Regular", fontSize: 13 },
  overlay: { flex: 1, paddingHorizontal: 16, justifyContent: "center" }, sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", padding: 20, borderRadius: 24, gap: 18 }, modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 16 }, button: { flex: 1, borderRadius: 12 },
});
