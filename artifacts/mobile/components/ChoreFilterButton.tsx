import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";

import { GlassControlSurface } from "@/components/GlassControlSurface";
import { useTheme } from "@/constants/colors";
import { withAlpha } from "@/lib/contrast";

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
  const foreground = selected ? colors.foreground : withAlpha(colors.foreground, 0.72);
  const tint = colors.accentGradient[1];
  const rim = withAlpha(tint, selected ? 0.8 : 0.32);
  const wash = withAlpha(tint, selected ? 0.24 : 0.08);
  const shape = pill ? styles.pill : styles.rounded;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      activeOpacity={0.8}
      hitSlop={4}
      style={[styles.button, shape, style]}
    >
      <GlassControlSurface borderless pointerEvents="none" style={[StyleSheet.absoluteFill, shape]}>
        <View style={[StyleSheet.absoluteFill, shape, { backgroundColor: wash }]} />
      </GlassControlSurface>
      {icon ? <Feather name={icon} size={13} color={foreground} /> : null}
      {!iconOnly ? <Text style={[styles.text, selected && styles.selectedText, { color: foreground }]}>{label}</Text> : null}
      {/* Keep one continuous outline above the glass and its tint layer. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, styles.rim, { borderColor: rim }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    flexShrink: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  rim: { borderWidth: 1 },
  rounded: { borderRadius: 10 },
  pill: { borderRadius: 22 },
  text: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13, flexShrink: 1, textAlign: "center" },
  selectedText: { fontFamily: "Inter_700Bold" },
});
