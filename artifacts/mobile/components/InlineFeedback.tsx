import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/constants/colors";

type FeedbackTone = "success" | "error" | "warning" | "info";

const icons: Record<FeedbackTone, keyof typeof Feather.glyphMap> = {
  success: "check-circle",
  error: "alert-circle",
  warning: "alert-triangle",
  info: "info",
};

export function InlineFeedback({ message, tone = "info", style }: {
  message: string;
  tone?: FeedbackTone;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const accent = tone === "success"
    ? colors.success
    : tone === "error"
      ? colors.destructive
      : tone === "warning"
        ? colors.warning
        : colors.primary;

  return (
    <View
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[
        styles.container,
        { backgroundColor: accent + "12", borderColor: accent + "44" },
        style,
      ]}
    >
      <Feather name={icons[tone]} size={16} color={accent} />
      <Text style={[styles.message, { color: accent }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  message: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18 },
});
