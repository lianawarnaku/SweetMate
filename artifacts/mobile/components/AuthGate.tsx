// Renders `children` when the user has a Supabase session, otherwise shows
// the sign-in screen. Sits inside AppProvider in the root layout so the rest
// of the app can assume it's always running behind a logged-in user.
//
// The brief loading state (while session or household data is restored) uses
// the same SweetMate tile mark as the native splash for a continuous handoff.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { HouseLoader } from "./HouseLoader";
import { HouseholdSetupScreen } from "./HouseholdSetupScreen";
import { PreferencesOnboardingScreen } from "./PreferencesOnboardingScreen";
import { SignInScreen } from "./SignInScreen";
import { useAppContext } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";

export function AuthGate({
  children,
  session,
  sessionLoading,
}: {
  children: React.ReactNode;
  session: Session | null;
  sessionLoading: boolean;
}) {
  const {
    householdId,
    householdLoading,
    householdError,
    refreshHousehold,
    preferencesLoaded,
    preferencesOnboardingPending,
    householdSetupStep,
  } = useAppContext();

  if (sessionLoading) {
    return <HouseLoader />;
  }

  if (!session) {
    return <SignInScreen />;
  }

  if (householdLoading || !preferencesLoaded) {
    return <HouseLoader />;
  }

  if (householdError) {
    return <HouseholdLoadError message={householdError} onRetry={refreshHousehold} />;
  }

  if (!householdId) return <HouseholdSetupScreen />;
  if (preferencesOnboardingPending && !householdSetupStep) {
    return <PreferencesOnboardingScreen />;
  }

  return <>{children}</>;
}

function HouseholdLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useTheme();
  return (
    <View style={[styles.errorScreen, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorTitle, { color: colors.foreground }]}>Households unavailable</Text>
      <Text style={[styles.errorMessage, { color: colors.mutedForeground }]}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.retryButton, { backgroundColor: colors.action }]}>
        <Text style={[styles.retryText, { color: colors.actionForeground }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  errorTitle: { fontFamily: "Inter_700Bold", fontSize: 22, textAlign: "center" },
  errorMessage: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 8 },
  retryButton: { minHeight: 48, minWidth: 140, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 20, paddingHorizontal: 20 },
  retryText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
