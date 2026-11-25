import React, { useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "@/components/GlassButton";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { AppSwitch } from "@/components/AppSwitch";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import type { usePersonalSchedule } from "@/hooks/usePersonalSchedule";
import type { ScheduleSources } from "@/lib/personalSchedule";
import { useGoogleCalendarConnection } from "@/hooks/useGoogleCalendarConnection";

export function GoogleScheduleControls({ schedule, householdId, day, placement }: { schedule: ReturnType<typeof usePersonalSchedule>; householdId: string | null; day: string; placement: "home" | "settings" }) {
  const colors = useTheme();
  const connection = useGoogleCalendarConnection(schedule.userId);
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const [visible, setVisible] = useState(false);
  const [sources, setSources] = useState<ScheduleSources | null>(null);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true); setError(null);
    try { await connection.connect(); setSources(await schedule.sources()); }
    catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Google could not connect."); }
    finally { setBusy(false); }
  };
  const open = async () => {
    if (busy || connection.busy) return;
    setCalendarIds(schedule.prefs?.calendar_ids ?? []);
    setTaskIds(schedule.prefs?.task_list_ids ?? []);
    setShareBusy(schedule.sharing);
    setSources(null); setError(null); setVisible(true); setBusy(true);
    try {
      if (!await connection.refresh()) await connection.connect();
      setSources(await schedule.sources());
    } catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Your Google calendars could not load."); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy && !connection.busy) setVisible(false); };
  const save = async (enabled = true) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const zone = schedule.prefs?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      if (householdId && (!shareBusy || !enabled)) await schedule.shareBusy(false);
      await schedule.configure(enabled ? calendarIds : [], enabled ? taskIds : [], zone, enabled);
      if (householdId && enabled && shareBusy) await schedule.shareBusy(true);
      setVisible(false);
    } catch (failure) { setError(failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Your schedule preferences could not save."); }
    finally { setBusy(false); }
  };
  const row = (id: string, name: string, selected: string[], set: (ids: string[]) => void) => <TouchableOpacity key={id} accessibilityRole="checkbox" accessibilityLabel={name} aria-checked={selected.includes(id)} accessibilityState={{ checked: selected.includes(id) }} disabled={busy}
    onPress={() => set(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])} style={styles.choice}>
    <Feather name={selected.includes(id) ? "check-square" : "square"} size={20} color={colors.foreground} /><Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
  </TouchableOpacity>;
  // Wait for the shared server status before offering connection on My Sweet.
  // Keep an in-progress first-time picker mounted after OAuth succeeds so the
  // user can finish choosing calendars/tasks before management moves to Settings.
  const showLauncher = placement === "settings" || connection.connected === false;
  const launcherLabel = placement === "settings" ? "Manage Google Calendar" : "Connect your Google schedule";
  const connectionError = placement === "home" && !visible ? connection.error : null;
  if (!showLauncher && !visible && !connectionError && !schedule.error) return null;

  return <View style={[styles.controls, placement === "settings" && styles.settingsControls]}>
    {showLauncher && <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={launcherLabel} disabled={!schedule.userId || busy || connection.busy} onPress={() => void open()} style={styles.link}>
        <Feather name="calendar" size={14} color={colors.mutedForeground} /><Text style={[styles.linkText, { color: colors.mutedForeground }]}>{launcherLabel}</Text>
      </TouchableOpacity>
      {placement === "settings" && schedule.prefs?.enabled && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh Google schedule" disabled={schedule.loading} onPress={() => void schedule.sync(day).catch(() => {})} style={styles.refresh}>
        {schedule.loading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />}
      </TouchableOpacity>}
    </View>}
    {connectionError && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{connectionError}</Text>}
    {schedule.error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{schedule.error}</Text>}
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <GlassModalBackdrop onPress={close} accessibilityLabel="Close Google schedule settings" />
        <GlassModalSurface style={styles.sheet}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Your Google schedule</Text>
          <ScrollView contentContainerStyle={{ gap: 14 }} style={{ flexShrink: 1 }}>
            {busy && <ActivityIndicator color={colors.foreground} />}
            {sources && <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>CALENDARS</Text>
              {sources.calendars.map((item) => row(item.id, item.name, calendarIds, setCalendarIds))}
              <Text style={[styles.label, { color: colors.mutedForeground }]}>GOOGLE TASKS</Text>
              {sources.taskLists.map((item) => row(item.id, item.name, taskIds, setTaskIds))}
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Selected calendars and task lists sync automatically. Day is before noon; Night starts at noon.</Text>
              {householdId && <View style={styles.sharing}>
                <View style={{ flex: 1, gap: 5 }}><Text style={[styles.name, { color: colors.foreground }]}>Share my busy status</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Roommates see only “Busy” and the end time while an event is happening.</Text></View>
                <AppSwitch value={shareBusy} onValueChange={setShareBusy} disabled={busy} accessibilityLabel="Share my calendar busy status with this household" />
              </View>}
            </>}
            {error && <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive }]}>{error}</Text>}
            {!sources && <GlassButton tone="neutral" disabled={busy} onPress={() => void connect()} style={{ borderRadius: 12 }}><Text style={[styles.name, { color: colors.foreground }]}>Connect or reconnect Google</Text></GlassButton>}
            {schedule.prefs?.enabled && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void save(false)} style={styles.link}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Stop importing</Text></TouchableOpacity>}
          </ScrollView>
          <View style={styles.actions}>
            <GlassButton tone="neutral" disabled={busy} onPress={close} style={styles.button}><Text style={[styles.name, { color: colors.foreground }]}>Cancel</Text></GlassButton>
            {sources && <GlassButton disabled={busy || calendarIds.length + taskIds.length === 0} onPress={() => void save()} style={styles.button}>{busy ? <ActivityIndicator color={colors.actionForeground} /> : <Text style={[styles.name, { color: colors.actionForeground }]}>Save</Text>}</GlassButton>}
          </View>
        </GlassModalSurface>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  controls: { marginHorizontal: 16, gap: 4 }, settingsControls: { marginHorizontal: 0 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, link: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  linkText: { fontFamily: "Inter_400Regular", fontSize: 12, textDecorationLine: "underline", flexShrink: 1 }, refresh: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, meta: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  overlay: { flex: 1, paddingHorizontal: 16, justifyContent: "center" }, sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", alignSelf: "center", borderRadius: 24, padding: 20, gap: 18 }, title: { fontFamily: "Inter_700Bold", fontSize: 21 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1, marginTop: 8 }, choice: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }, name: { fontFamily: "Inter_600SemiBold", fontSize: 14, flexShrink: 1 },
  sharing: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }, actions: { flexDirection: "row", gap: 10 }, button: { flex: 1, borderRadius: 12 },
});
