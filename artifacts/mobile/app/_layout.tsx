import {
  BarlowCondensed_400Regular,
  BarlowCondensed_500Medium,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from "@expo-google-fonts/barlow-condensed";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as SystemUI from "expo-system-ui";
import { NavigationThemeProvider } from "@/components/NavigationThemeProvider";
import { BRAND_BASE_DARK } from "@/constants/brand";

import { AuthGate } from "@/components/AuthGate";
import { HouseLoader } from "@/components/HouseLoader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QuickGuideModal } from "@/components/QuickGuideModal";
import { NudgeToast } from "@/components/NudgeToast";
import { AnalyticsConsentManager } from "@/components/AnalyticsConsentManager";
import { HouseholdSetupRouteGuard } from "@/components/HouseholdSetupRouteGuard";
import { AppPopupProvider } from "@/components/AppPopupProvider";
import { WebThemeFocusStyles } from "@/components/WebThemeFocusStyles";
import { AppProvider } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { setBaseUrl } from "@workspace/api-client-react";
import {
  installGlobalRuntimeDiagnostics,
  reportRuntimeError,
} from "@/lib/runtimeDiagnostics";

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore if splash screen is not available (web)
});
SplashScreen.setOptions({ duration: 250, fade: true });

const queryClient = new QueryClient();

function ThemedStatusBar() {
  const colors = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch((error) =>
      reportRuntimeError("set window background color", error),
    );
  }, [colors.background]);
  return <StatusBar style={colors.mode === "dark" ? "light" : "dark"} />;
}

export default function RootLayout() {
  // Restore the auth session exactly once. The same result is shared by the
  // provider and gate, and the lookup can finish behind the launch screen.
  const { session, loading: sessionLoading } = useSupabaseSession();
  const [launchAnimationComplete, setLaunchAnimationComplete] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    // Keep the established aliases so every existing screen adopts the new
    // condensed SweetMate type system without scattered one-off font changes.
    Inter_400Regular: BarlowCondensed_400Regular,
    Inter_500Medium: BarlowCondensed_500Medium,
    Inter_600SemiBold: BarlowCondensed_600SemiBold,
    Inter_700Bold: BarlowCondensed_700Bold,
  });

  useEffect(() => {
    return installGlobalRuntimeDiagnostics();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      const launchTimer = setTimeout(() => setLaunchAnimationComplete(true), 1200);
      return () => clearTimeout(launchTimer);
    }
  }, [fontsLoaded, fontError]);

  const splashHidden = useRef(false);
  const onRootLayout = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
              <ErrorBoundary
                onError={(error, componentStack) =>
                  reportRuntimeError("React render", error, { componentStack })
                }
              >
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: BRAND_BASE_DARK }} onLayout={onRootLayout}>
            <AppProvider session={session}>
              <NavigationThemeProvider>
                <WebThemeFocusStyles />
                <ThemedStatusBar />
                <AppPopupProvider>
                  <AnalyticsConsentManager session={session} />
                  {!launchAnimationComplete ? (
                    <HouseLoader />
                  ) : (
                    <AuthGate session={session} sessionLoading={sessionLoading}>
                      <>
                        <HouseholdSetupRouteGuard />
                        <Stack
                          screenOptions={{
                            headerShown: false,
                            animation: "fade_from_bottom",
                            animationDuration: 220,
                            gestureEnabled: true,
                          }}
                          initialRouteName="(tabs)"
                        >
                          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                          <Stack.Screen name="settings" options={{ headerShown: false, presentation: "card" }} />
                          <Stack.Screen name="planning" options={{ headerShown: false, presentation: "card" }} />
                          <Stack.Screen name="task-difficulty" options={{ headerShown: false, presentation: "card" }} />
                          <Stack.Screen name="alerts" options={{ headerShown: false, presentation: "card" }} />
                          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
                          <Stack.Screen name="+not-found" />
                        </Stack>
                        <QuickGuideModal />
                        <NudgeToast />
                      </>
                    </AuthGate>
                  )}
                </AppPopupProvider>
              </NavigationThemeProvider>
            </AppProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
