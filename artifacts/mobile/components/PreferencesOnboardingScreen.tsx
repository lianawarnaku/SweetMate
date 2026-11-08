import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { UserPreferencesPanel } from "@/components/UserPreferencesPanel";
import { HouseholdCompletionControl } from "@/components/HouseholdCompletionControl";
import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { SmoothPressable } from "@/components/SmoothPressable";
import { InviteCodeCard } from "@/components/InviteCodeCard";
import { useOnboardingAnalytics } from "@/hooks/useOnboardingAnalytics";

export function PreferencesOnboardingScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const {
    finishPreferencesOnboarding,
    currentUserId,
    householdName,
    inviteCode,
    householdLoading,
    refreshHousehold,
  } = useAppContext();

  const onboarding = useOnboardingAnalytics({
    userId: currentUserId,
    flow: "preferences",
    context: "first_household",
    step: "preferences",
  });
  const finishing = React.useRef(false);
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      await finishPreferencesOnboarding();
      onboarding.completeStep();
      onboarding.complete();
    } finally {
      finishing.current = false;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 28,
          paddingBottom: insets.bottom + 28,
        }}
      >
        <View style={styles.brand}><BrandMark transition size={58} color={colors.primary} /></View>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>YOUR SWEET IS READY</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{householdName ?? "Your Sweet"}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Invite your Sweetmates now, then choose how your household experience looks.
        </Text>
        <InviteCodeCard
          inviteCode={inviteCode}
          loading={householdLoading}
          onRetry={refreshHousehold}
        />
        <UserPreferencesPanel />
        <View style={styles.completion}>
          <HouseholdCompletionControl />
        </View>
        <SmoothPressable
          accessibilityRole="button"
          onPress={() => void finish()}
          style={[styles.continueButton, { backgroundColor: colors.action }]}
        >
          <Text style={styles.continueText}>Continue</Text>
          <Feather name="arrow-right" size={18} color="#fff" />
        </SmoothPressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { alignItems: "center", marginBottom: 12 },
  eyebrow: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 12,
    letterSpacing: 1.5,
    textAlign: "center",
  },
  title: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 32,
    lineHeight: 36,
    textAlign: "center",
    marginTop: 5,
  },
  subtitle: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 16,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
    marginHorizontal: 30,
    marginBottom: 22,
  },
  continueButton: {
    height: 56,
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  continueText: { color: "#fff", fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 17 },
  completion: { marginTop: 16 },
});
