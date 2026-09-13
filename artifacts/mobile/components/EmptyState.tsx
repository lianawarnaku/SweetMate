import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/constants/colors";

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, subtitle, compact = false }: EmptyStateProps) {
  const colors = useTheme();
  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <View
        style={[
          styles.iconContainer,
          compact && styles.compactIconContainer,
          { backgroundColor: colors.secondary },
        ]}
      >
        <Feather name={icon} size={compact ? 22 : 32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  compactContainer: { paddingVertical: 28, gap: 8 },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  compactIconContainer: { width: 48, height: 48, borderRadius: 24, marginBottom: 2 },
  title: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
