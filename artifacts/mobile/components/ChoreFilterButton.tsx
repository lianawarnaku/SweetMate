import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/constants/colors";

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  icon?: keyof typeof Feather.glyphMap;
  style?: StyleProp<ViewStyle>;
};

export function ChoreFilterButton({ label, selected, onPress, accessibilityLabel, icon, style }: Props) {
  const colors = useTheme();
  const foreground = selected ? colors.primaryForeground : colors.mutedForeground;
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={[styles.button, { backgroundColor: selected ? colors.primary : colors.secondary }, style]}
    >
      {icon ? <Feather name={icon} size={13} color={foreground} /> : null}
      <Text style={[styles.text, { color: foreground }]}>{label}</Text>
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
  text: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13, flexShrink: 1, textAlign: "center" },
});
