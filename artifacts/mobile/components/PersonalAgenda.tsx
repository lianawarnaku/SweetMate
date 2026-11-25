import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
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
import { withAlpha } from "@/lib/contrast";
import { scheduleDateKey, scheduleDateLabel, scheduleItemCompletionProgress, scheduleItemPeriod, scheduleItemProgress, scheduleItemTimes, scheduleItemsForDay, scheduleTimeLabel, type PersonalScheduleItem, type TaskScheduleUpdate } from "@/lib/personalSchedule";
import type { Chore } from "@/context/AppContext";

function ScheduleCheck({ item, now, pending, disabled, onPress, style }: {
  item: PersonalScheduleItem; now: number; pending: boolean; disabled: boolean;
  onPress: () => void; style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const progress = scheduleItemCompletionProgress(item, now);
  const timed = Boolean(scheduleItemTimes(item).start && scheduleItemTimes(item).end);
  const circumference = 2 * Math.PI * 21;
  return <TouchableOpacity accessibilityRole="checkbox"
    accessibilityLabel={`${item.app_completed_at ? "Mark incomplete" : "Complete"} in SweetMate: ${item.title}`}
    accessibilityHint={item.app_completed_at ? "Completed in SweetMate." : timed ? `Time block ${Math.round(progress * 100)} percent elapsed. Completion is tracked in SweetMate.` : "Completion is tracked in SweetMate."}
    aria-checked={Boolean(item.app_completed_at)} accessibilityState={{ checked: Boolean(item.app_completed_at), busy: pending, disabled }}
    disabled={disabled} onPress={onPress} activeOpacity={0.75} hitSlop={4} style={[styles.check, style]}>
    <View pointerEvents="none" style={styles.ring}>
      <Svg width={48} height={48} style={StyleSheet.absoluteFill}>
        <Circle cx={24} cy={24} r={21} fill="none" stroke={withAlpha(colors.foreground, 0.24)} strokeWidth={2.5} />
        {progress > 0 && <Circle cx={24} cy={24} r={21} fill="none" stroke={colors.foreground} strokeWidth={2.5} strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation={-90} origin="24,24" />}
      </Svg>
      {pending ? <ActivityIndicator size="small" color={colors.foreground} /> : <GlassCheckCircle size={22} state={item.app_completed_at ? "checked" : "idle"} />}
    </View>
  </TouchableOpacity>;
}

export function PersonalAgenda({ items, chores, day, timezone, renderChore, onUpdateItem }: {
  items: PersonalScheduleItem[]; chores: Chore[]; day: string; timezone: string;
  renderChore: (chore: Chore) => React.ReactNode; onUpdateItem: (id: string, update: TaskScheduleUpdate) => Promise<void>;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [now, setNow] = useState(Date.now);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = items.find(item => item.id === selectedId) ?? null;
  const isTask = selectedItem?.source === "google-task";
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
    try { await onUpdateItem(item.id, value); }
    catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "This item could not be updated."); }
    finally { working.current = false; setUpdating(null); }
  };
  const open = (item: PersonalScheduleItem) => {
    setSelectedId(item.id); setPeriod(scheduleItemPeriod(item, timezone, day)); setError(null);
    const clock = (stamp: string | null) => stamp ? new Date(stamp).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
    setStart(clock(item.override_start)); setEnd(clock(item.override_end));
  };
  const close = () => { if (!working.current) { setSelectedId(null); setError(null); } };
  const save = async () => {
    if (!selectedItem || !isTask || working.current) return;
    const valid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if ((start || end) && (!valid(start) || !valid(end) || end <= start)) { setError("Use HH:MM (24-hour time), with the end after the start."); return; }
    const stamp = (value: string) => householdDueDate(day, Number(value.slice(0, 2)), timezone, Number(value.slice(3, 5)));
    working.current = true; setSaving(true); setError(null);
    try { await onUpdateItem(selectedItem.id, { period, ...(start && end ? { start: stamp(start), end: stamp(end) } : { clearTime: true }) }); setSelectedId(null); }
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
        {personal.map((item) => {
          const progress = scheduleItemProgress(item, now);
          const remaining = progress ? Math.ceil(progress.remainingMs / 60000) : 0;
          return <Surface key={item.id} style={styles.event}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View details: ${item.title}`}
              accessibilityHint="Opens item details in SweetMate" disabled={saving || Boolean(updating)}
              activeOpacity={0.75} style={styles.eventButton} onPress={() => open(item)}>
              <View style={styles.row}>
                <View style={styles.checkSlot} />
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: colors.foreground, textDecorationLine: item.app_completed_at ? "line-through" : "none" }]}>{item.title}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{scheduleTimeLabel(item, timezone)}</Text>
                  {progress && <Text style={[styles.live, { color: colors.foreground }]}>Happening now · {remaining >= 60 ? `${Math.ceil(remaining / 60)}h` : `${remaining}m`} left</Text>}
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
            <ScheduleCheck item={item} now={now} pending={updating === item.id} disabled={saving || Boolean(updating)}
              style={styles.checkOverlay} onPress={() => void update(item, { completed: !item.app_completed_at })} />
          </Surface>;
        })}
        {!dayChores.length && !personal.length && <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing planned</Text>}
      </View>;
    })}
    {error && !selectedItem && <Text accessibilityRole="alert" style={[styles.message, { color: colors.destructive }]}>{error}</Text>}
    <Modal visible={selectedItem !== null} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <GlassModalBackdrop onPress={close} accessibilityLabel="Close item details" />
        <GlassModalSurface style={styles.sheet}>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{isTask ? "Google Task" : "Google Calendar event"}</Text>
          <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.foreground }]}>{selectedItem?.title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
            {selectedItem && <>
              <Text style={[styles.meta, { color: colors.foreground }]}>{scheduleDateLabel(selectedItem, timezone)} · {scheduleTimeLabel(selectedItem, timezone)}</Text>
              <View style={styles.row}>
                <ScheduleCheck item={selectedItem} now={now} pending={updating === selectedItem.id} disabled={saving || Boolean(updating)} onPress={() => void update(selectedItem, { completed: !selectedItem.app_completed_at })} />
                <Text style={[styles.meta, { color: colors.foreground }]}>{selectedItem.app_completed_at ? "Completed in SweetMate" : "Mark complete in SweetMate"}</Text>
              </View>
            </>}
            {isTask && <>
              <View accessibilityRole="radiogroup" style={styles.row}>
                {(["morning", "night"] as const).map((value) => <GlassButton key={value} tone={period === value ? "primary" : "neutral"} disabled={saving || Boolean(updating)} accessibilityRole="radio" aria-checked={period === value} accessibilityState={{ checked: period === value }} onPress={() => { setPeriod(value); setStart(""); setEnd(""); }} style={{ flex: 1, borderRadius: 12 }}>
                  <Text style={[styles.title, { color: period === value ? colors.actionForeground : colors.foreground }]}>{value === "morning" ? "Morning" : "Night"}</Text>
                </GlassButton>)}
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Optional time block · 24-hour time</Text>
              <View style={styles.row}>
                <View style={styles.copy}><Text style={[styles.meta, { color: colors.mutedForeground }]}>Start</Text><TextInput accessibilityLabel="Task start time, HH:MM" value={start} onChangeText={setStart} placeholder="09:00" placeholderTextColor={colors.mutedForeground} editable={!saving && !updating} maxLength={5} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]} /></View>
                <View style={styles.copy}><Text style={[styles.meta, { color: colors.mutedForeground }]}>End</Text><TextInput accessibilityLabel="Task end time, HH:MM" value={end} onChangeText={setEnd} placeholder="10:00" placeholderTextColor={colors.mutedForeground} editable={!saving && !updating} maxLength={5} style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]} /></View>
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Task checkmarks and added times are saved in SweetMate.</Text>
            </>}
            {selectedItem?.link && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${selectedItem.title} in Google`} style={styles.googleLink}
              onPress={() => void Linking.openURL(selectedItem.link!).catch(() => setError("This Google item could not open."))}>
              <Text style={[styles.meta, { color: colors.mutedForeground, textDecorationLine: "underline" }]}>Open in Google</Text>
            </TouchableOpacity>}
            {error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error}</Text>}
          </ScrollView>
          <View style={styles.row}>
            <GlassButton tone="neutral" disabled={saving || Boolean(updating)} onPress={close} style={styles.button}><Text style={[styles.title, { color: colors.foreground }]}>{isTask ? "Cancel" : "Done"}</Text></GlassButton>
            {isTask && <GlassButton disabled={saving || Boolean(updating)} onPress={() => void save()} style={styles.button}>{saving ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.title, { color: colors.actionForeground }]}>Save</Text>}</GlassButton>}
          </View>
        </GlassModalSurface>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  period: { gap: 8, paddingBottom: 16 }, periodTitle: { marginHorizontal: 16, minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 }, heading: { fontFamily: "Inter_700Bold", fontSize: 17 },
  event: { marginHorizontal: 16, marginBottom: 4, borderRadius: 18 }, eventButton: { padding: 14, minHeight: 76 }, row: { flexDirection: "row", alignItems: "center", gap: 10 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 14 }, meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }, live: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  check: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }, checkSlot: { width: 48, minHeight: 48 }, checkOverlay: { position: "absolute", left: 14, top: 0, bottom: 0 }, ring: { width: 48, height: 48, justifyContent: "center", alignItems: "center" },
  empty: { marginHorizontal: 16, fontFamily: "Inter_400Regular", fontSize: 13, paddingBottom: 8 }, message: { marginHorizontal: 16, fontFamily: "Inter_400Regular", fontSize: 13 },
  overlay: { flex: 1, paddingHorizontal: 16, justifyContent: "center" }, sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", padding: 20, borderRadius: 24, gap: 18 }, modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 16 }, button: { flex: 1, borderRadius: 12 }, googleLink: { minHeight: 44, justifyContent: "center" },
});
