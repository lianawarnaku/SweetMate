import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { colorSchemes, resolveThemeTokens, type ColorScheme, useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { SmoothPressable } from "@/components/SmoothPressable";

const SCHEME_LABELS: Record<ColorScheme, string> = {
  mono: "Black & White",
  brown: "Brown",
  pinkWhite: "Pink + White",
  blueWhite: "Navy Blue",
};

export function UserPreferencesPanel() {
  const colors = useTheme();
  const {
    colorScheme,
    setColorScheme,
    pointsEnabled,
    setPointsEnabled,
    plantEnabled,
    setPlantEnabled,
    roommateActivityEnabled,
    setRoommateActivityEnabled,
  } = useAppContext();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>App Appearance</Text>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Accent</Text>
      <View style={styles.schemeGrid}>
        {(Object.keys(colorSchemes) as ColorScheme[]).map((scheme) => {
          const palette = resolveThemeTokens("dark", scheme);
          const active = colorScheme === scheme;
          return (
            <SmoothPressable
              key={scheme}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              aria-checked={active}
              onPress={() => setColorScheme(scheme)}
              containerStyle={styles.schemeOptionSlot}
              style={[
                styles.schemeOption,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            >
              <View
                style={[
                  styles.schemeSwatch,
                  { backgroundColor: palette.background, borderColor: palette.border },
                ]}
              >
                <View style={[styles.schemeSwatchPrimary, { backgroundColor: palette.primary }]} />
              </View>
              <Text style={[styles.schemeLabel, { color: colors.foreground }]}>
                {SCHEME_LABELS[scheme]}
              </Text>
              {active && <Feather name="check-circle" size={18} color={colors.primary} />}
            </SmoothPressable>
          );
        })}
      </View>
      <View style={[styles.preferenceRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>
          Show Roommate Activity
        </Text>
        <Switch
          value={roommateActivityEnabled}
          onValueChange={setRoommateActivityEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>
      <View style={[styles.preferenceRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>
          Show points & leaderboard
        </Text>
        <Switch
          value={pointsEnabled}
          onValueChange={setPointsEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>
      <View style={[styles.preferenceRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.preferenceLabel, { color: colors.foreground }]}>
          Show House Monitor
        </Text>
        <Switch
          value={plantEnabled}
          onValueChange={setPlantEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 18 },
  sectionLabel: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  schemeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  schemeOptionSlot: { width: "48%" },
  schemeOption: {
    width: "100%",
    minHeight: 62,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  schemeSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  schemeSwatchPrimary: { width: 17, height: 17, borderRadius: 9 },
  schemeLabel: { flex: 1, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 },
  preferenceRow: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    paddingTop: 10,
  },
  preferenceLabel: {
    flex: 1,
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 14,
    paddingRight: 12,
  },
});
