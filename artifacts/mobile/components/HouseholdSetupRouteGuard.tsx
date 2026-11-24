import AsyncStorage from "@react-native-async-storage/async-storage";
import { householdSetupDestinationKey, householdSetupDestinationRoute } from "@/lib/householdSetup";
import { pendingHouseholdSetupRecovery, consumeHouseholdSetupRecovery } from "@/lib/householdSetupRecovery";
import { router, usePathname } from "expo-router";
import React, { useEffect, useRef } from "react";

import { useAppContextSelector } from "@/context/AppContext";

export function HouseholdSetupRouteGuard() {
  const pathname = usePathname();
  const setupStep = useAppContextSelector((context) => context.householdSetupStep);
  const { householdId, householdSetupDataReady, currentUserId } = useAppContextSelector((context) => ({
    householdId: context.householdId,
    currentUserId: context.currentUserId,
    householdSetupDataReady: context.householdSetupDataReady,
  }));
  const lastRedirectRef = useRef<string | null>(null);

  useEffect(() => {
    const recoveryTarget = pendingHouseholdSetupRecovery();
    if (recoveryTarget) {
      if (householdSetupDataReady && householdId === recoveryTarget && consumeHouseholdSetupRecovery(recoveryTarget)) {
        router.replace(`/sweet-setup?resume=1&household=${recoveryTarget}` as never);
      }
      return;
    }
    if (!setupStep) {
      lastRedirectRef.current = null;
      return;
    }
    const allowed =
      pathname === "/sweet-setup" ||
      (setupStep === "essentials" && pathname === "/planning");
    if (allowed) {
      lastRedirectRef.current = null;
      return;
    }
    const target = "/sweet-setup";
    const redirectKey = `${setupStep}:${pathname}:${target}`;
    if (lastRedirectRef.current === redirectKey) return;
    lastRedirectRef.current = redirectKey;
    router.replace(target as never);
  }, [pathname, setupStep, householdId, householdSetupDataReady]);

  useEffect(() => {
    if (!householdId || !householdSetupDataReady || setupStep) return;
    let active = true;
    const key = householdSetupDestinationKey(currentUserId);
    void (async () => {
      const raw = await AsyncStorage.getItem(key);
      if (!active || !raw) return;
      const pending = JSON.parse(raw);
      if (pending.householdId !== householdId || !["app", "chore-chart"].includes(pending.destination)) return;
      await AsyncStorage.removeItem(key);
      if (active) router.replace(householdSetupDestinationRoute(pending.destination) as never);
    })().catch(() => { /* Keep the saved destination available for a later retry. */ });
    return () => { active = false; };
  }, [householdId, householdSetupDataReady, currentUserId, setupStep, pathname]);

  return null;
}
