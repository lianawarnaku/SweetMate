import { StyleSheet, Text, View } from "react-native";

import { HeaderActions } from "@/components/HeaderActions";
import { useTheme } from "@/constants/colors";

type ScreenHeaderProps = {
  title: string;
  subtitle: string;
  topPadding: number;
};

/** Shared hierarchy and spacing for primary tab screens. */
export function ScreenHeader({ title, subtitle, topPadding }: ScreenHeaderProps) {
  const colors = useTheme();

  return (
    <View
      style={[
        styles.header,
        { paddingTop: topPadding, backgroundColor: colors.background },
      ]}
    >
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <HeaderActions />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 104,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, marginTop: 2 },
});
