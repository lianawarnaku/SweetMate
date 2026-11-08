import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/constants/colors";

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  icon?: keyof typeof Feather.glyphMap;
  iconOnly?: boolean;
  pill?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ChoreFilterButton({ label, selected, onPress, accessibilityLabel, icon, iconOnly = false, pill = false, style }: Props) {
  const colors = useTheme();
  const foreground = selected ? colors.primaryForeground : colors.mutedForeground;
  const content = <>
    {icon ? <Feather name={icon} size={13} color={foreground} /> : null}
    {!iconOnly ? <Text style={[styles.text, { color: foreground }]}>{label}</Text> : null}
  </>;
  const fill = { backgroundColor: selected ? colors.primary : colors.secondary };
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={pill ? [styles.pillTouchTarget, style] : [styles.button, fill, style]}
    >
      {pill ? <View style={[styles.button, styles.pill, fill]}>{content}</View> : content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
  },
  // The visible pill is compact, while its transparent touch target stays easy
  // to hit. Neither layer grows to consume unused row width.
  pillTouchTarget: { minHeight: 44, minWidth: 44, alignSelf: "flex-start", alignItems: "center", justifyContent: "center" },
  pill: { minHeight: 30, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  text: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13, flexShrink: 1, textAlign: "center" },
});
