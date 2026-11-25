import React, { useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/constants/colors";
import { localDateKey } from "@/lib/calendarItems";
import { householdDateKey } from "@/lib/choreTimezone";
import { formatShoppingSchedule, shoppingMonthDays, shoppingTimeFromClock, type ShoppingSchedule } from "@/lib/shoppingSchedule";

export function ShoppingScheduleField({ value, onChange, onEditingChange, timezone }: {
  value?: ShoppingSchedule;
  onChange: (value: ShoppingSchedule | undefined) => void;
  onEditingChange: (editing: boolean) => void;
  timezone: string;
}) {
  const colors = useTheme();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [month, setMonth] = useState(new Date());
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("00");
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [error, setError] = useState<string | null>(null);
  const close = () => { setOpen(false); onEditingChange(false); Keyboard.dismiss(); };
  const edit = () => {
    Keyboard.dismiss();
    const day = value?.date ?? householdDateKey(new Date(), timezone);
    const [h, m] = (value?.time ?? "09:00").split(":").map(Number);
    setDate(day); setMonth(new Date(`${day}T12:00:00`));
    setHour(String(h % 12 || 12)); setMinute(String(m).padStart(2, "0")); setPeriod(h >= 12 ? "PM" : "AM");
    setError(null); setOpen(true); onEditingChange(true);
  };
  const save = () => {
    const time = shoppingTimeFromClock(hour, minute, period);
    if (!time) { setError("Enter an hour from 1–12 and minutes from 00–59."); return; }
    onChange({ date, time }); close();
  };
  const input = [styles.clockInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.cardElevated }];
  const days = shoppingMonthDays(month);
  return <View style={styles.root}>
    <View style={styles.buttonRow}>
      <GlassButton tone="neutral" onPress={edit} accessibilityLabel={value ? "Change shopping calendar date and time" : "Add shopping to calendar"} style={styles.calendarButton}>
        <Feather name="calendar" size={18} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground, flexShrink: 1 }]}>{value ? formatShoppingSchedule(value) : "Add to calendar"}</Text>
        {!value && <Feather name="plus" size={16} color={colors.mutedForeground} />}
      </GlassButton>
      {value && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove shopping calendar date and time" onPress={() => { onChange(undefined); close(); }} style={styles.clear}>
        <Feather name="x" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>}
    </View>
    {open && <View style={[styles.picker, { borderColor: colors.border }]}>
      <View style={styles.monthHeader}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous shopping month" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} style={styles.clear}><Feather name="chevron-left" size={19} color={colors.foreground} /></TouchableOpacity>
        <Text accessibilityRole="header" style={[styles.buttonText, { color: colors.foreground, flex: 1, textAlign: "center" }]}>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next shopping month" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))} style={styles.clear}><Feather name="chevron-right" size={19} color={colors.foreground} /></TouchableOpacity>
      </View>
      <View style={styles.week}>{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <Text key={index} style={[styles.weekday, { color: colors.mutedForeground }]}>{day}</Text>)}</View>
      {Array.from({ length: 6 }, (_, row) => <View key={row} style={styles.week}>
        {days.slice(row * 7, row * 7 + 7).map(day => {
          const key = localDateKey(day), selected = key === date;
          return <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Schedule shopping on ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
            onPress={() => setDate(key)} style={[styles.day, { backgroundColor: selected ? colors.action : "transparent" }]}>
            <Text style={[styles.dayText, { color: selected ? colors.actionForeground : day.getMonth() === month.getMonth() ? colors.foreground : colors.mutedForeground }]}>{day.getDate()}</Text>
          </TouchableOpacity>;
        })}
      </View>)}
      <View style={styles.clock}>
        <Text style={[styles.buttonText, { color: colors.foreground }]}>Time</Text>
        <TextInput accessibilityLabel="Shopping hour" value={hour} onChangeText={setHour} keyboardType="number-pad" maxLength={2} selectTextOnFocus selectionColor={colors.foreground} style={input} />
        <Text style={{ color: colors.foreground }}>:</Text>
        <TextInput accessibilityLabel="Shopping minutes" value={minute} onChangeText={setMinute} keyboardType="number-pad" maxLength={2} selectTextOnFocus selectionColor={colors.foreground} style={input} />
        {(["AM", "PM"] as const).map(value => <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ checked: period === value }} aria-checked={period === value} accessibilityLabel={value} onPress={() => setPeriod(value)} style={[styles.period, { backgroundColor: period === value ? colors.action : colors.muted }]}>
          <Text style={[styles.buttonText, { color: period === value ? colors.actionForeground : colors.foreground }]}>{value}</Text>
        </TouchableOpacity>)}
      </View>
      {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
      <View style={styles.actions}>
        <GlassButton tone="neutral" onPress={close} style={styles.action}><Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text></GlassButton>
        <GlassButton onPress={save} style={styles.action}><Text style={[styles.buttonText, { color: colors.actionForeground }]}>Done</Text></GlassButton>
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 10 }, buttonRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  calendarButton: { flex: 1, borderRadius: 12 }, buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  picker: { borderWidth: 1, borderRadius: 16, padding: 8, gap: 4 }, monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  week: { flexDirection: "row" }, weekday: { flex: 1, textAlign: "center", fontFamily: "Inter_500Medium", fontSize: 11, paddingVertical: 5 },
  day: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 9 }, dayText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  clock: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4, marginTop: 10 },
  clockInput: { width: 40, minHeight: 44, borderWidth: 1, borderRadius: 9, textAlign: "center", fontFamily: "Inter_500Medium", fontSize: 16 },
  period: { minWidth: 36, minHeight: 44, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, action: { flex: 1, borderRadius: 12 },
});
