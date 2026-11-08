import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/constants/colors";

type Props = {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SectionDivider({ title, icon, count, expanded, onToggle, style }: Props) {
  const colors = useTheme();
  const content = <>
    <View style={[styles.line, { backgroundColor: colors.mutedForeground }]} />
    <View style={styles.label}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {count !== undefined && <Text style={[styles.count, { color: colors.mutedForeground }]}>{count}</Text>}
      {onToggle && <Feather name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.mutedForeground} />}
    </View>
    <View style={[styles.line, { backgroundColor: colors.mutedForeground }]} />
  </>;
  return onToggle ? (
    <TouchableOpacity
      style={[styles.row, styles.interactive, style]}
      onPress={onToggle}
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
