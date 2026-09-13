import { Feather } from "@expo/vector-icons";
import React, { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/constants/colors";

export function HistoryDisclosure({
  count,
  expanded,
  onToggle,
  children,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const colors = useTheme();
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`History, ${count} records`}
        accessibilityHint={expanded ? "Collapses history" : "Expands history"}
        onPress={onToggle}
        style={[
          styles.header,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="archive" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          History ({count})
        </Text>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={19}
          color={colors.mutedForeground}
        />
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, gap: 10 },
  header: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
