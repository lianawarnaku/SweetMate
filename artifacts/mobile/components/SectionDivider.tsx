import { useRef } from "react";
import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/constants/colors";

type Props = {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  count?: number;
  iconOnly?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onLongPress?: () => void;
  longPressHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function SectionDivider({ title, icon, count, iconOnly = false, expanded, onToggle, onLongPress, longPressHint, style }: Props) {
  const colors = useTheme();
  const held = useRef(false);
  const content = <>
    <View style={[styles.line, { backgroundColor: colors.mutedForeground }]} />
    <View style={styles.label}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      {!iconOnly && <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{title}</Text>}
      {!iconOnly && count !== undefined && <Text style={[styles.count, { color: colors.mutedForeground }]}>{count}</Text>}
      {!iconOnly && onToggle && <Feather name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.mutedForeground} />}
    </View>
    <View style={[styles.line, { backgroundColor: colors.mutedForeground }]} />
  </>;
  return onToggle ? (
    <TouchableOpacity
      style={[styles.row, styles.interactive, style]}
      onPressIn={() => { held.current = false; }}
      onPress={() => { if (!held.current) onToggle(); }}
      onLongPress={onLongPress ? () => { held.current = true; onLongPress(); } : undefined}
      delayLongPress={450}
      accessibilityHint={longPressHint}
      accessibilityActions={onLongPress ? [{ name: "undo", label: "Undo checked-off items" }] : undefined}
      onAccessibilityAction={onLongPress ? (event) => {
        if (event.nativeEvent.actionName === "undo") onLongPress();
      } : undefined}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}${count === undefined ? "" : `, ${count} ${count === 1 ? "item" : "items"}`}`}
    >{content}</TouchableOpacity>
  ) : <View style={[styles.row, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36, marginTop: 18, marginBottom: 10 },
  interactive: { minHeight: 44 },
  line: { flex: 1, height: 1.5, opacity: 0.65, borderRadius: 1 },
  label: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 1 },
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15, flexShrink: 1 },
  count: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },
});
