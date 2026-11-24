import AsyncStorage from "@react-native-async-storage/async-storage";
import { householdSetupDestinationKey, type HouseholdSetupDestination } from "@/lib/householdSetup";
import { GlassButton } from "@/components/GlassButton";
import { useAppPopup } from "@/components/AppPopupProvider";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { UserPreferencesPanel } from "@/components/UserPreferencesPanel";
import { HouseholdCompletionControl } from "@/components/HouseholdCompletionControl";
import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { InviteCodeCard } from "@/components/InviteCodeCard";
import { useOnboardingAnalytics } from "@/hooks/useOnboardingAnalytics";

export function PreferencesOnboardingScreen() {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const [saving, setSaving] = React.useState(false);
  const insets = useSafeAreaInsets();
  const {
    finishPreferencesOnboarding,
    currentUserId,
    householdId,
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
  const finish = async (destination: HouseholdSetupDestination) => {
    if (finishing.current || !householdId) return;
    finishing.current = true;
    setSaving(true);
    try {
      // The navigator remounts after preferences. Its guard resumes this saved
      // destination only after the complete household is ready.
      await AsyncStorage.setItem(householdSetupDestinationKey(currentUserId), JSON.stringify({ householdId, destination }));
      await finishPreferencesOnboarding();
      onboarding.completeStep();
      onboarding.complete();
    } catch {
      showPopup({ title: "Couldn't finish setup", message: "Your household is saved. Please try choosing what to do next again.", actions: [{ label: "OK" }] });
    } finally {
      setSaving(false);
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
        <View style={{ marginHorizontal: 20, marginTop: 18, gap: 12 }}>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, marginBottom: 0 }]}>Choose what to do next. Your household and preferences are saved with either option.</Text>
          <GlassButton style={{ borderRadius: 12 }} disabled={saving} accessibilityLabel="Set up chore chart now" onPress={() => void finish("chore-chart")}>
            <Text style={[styles.continueText, { color: colors.actionForeground, flexShrink: 1, textAlign: "center" }]}>Set up chore chart now</Text>
          </GlassButton>
          <Pressable accessibilityRole="button" disabled={saving} accessibilityLabel="Skip and do later" onPress={() => void finish("app")} style={{ minHeight: 44, alignSelf: "flex-end", alignItems: "flex-end", justifyContent: "flex-start", paddingTop: 4, marginTop: -8, opacity: saving ? 0.5 : 1 }}>
            <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: colors.mutedForeground, textDecorationLine: "underline", textAlign: "right" }}>Skip and do later</Text>
          </Pressable>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, marginBottom: 0 }]}>You can return to Settings → Household Preferences → Chore Chart whenever you're ready.</Text>
        </View>
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
