import { backWithFallback } from "@/lib/navigation";
import { requestHouseholdSetupRecovery } from "@/lib/householdSetupRecovery";
import { HouseholdSetupScreen } from "@/components/HouseholdSetupScreen";
import React, { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useAppContext } from "@/context/AppContext";
import { router, useLocalSearchParams } from "expo-router";

export default function SweetSetupRoute() {
  const params = useLocalSearchParams<{ mode?: string; additional?: string; resume?: string; household?: string }>();
  const { householdId, memberships, switchSweet, householdSetupDataReady, setHouseholdSetupStep } = useAppContext();
  const resumeExistingHousehold = params.resume === "1";
  const target = params.household ?? householdId;
  const targetMembership = memberships.find((membership) => membership.sweetId === target);
  useEffect(() => {
    if (!resumeExistingHousehold || !targetMembership) return;
    if (householdId !== targetMembership.sweetId) {
      requestHouseholdSetupRecovery(targetMembership.sweetId);
      switchSweet(targetMembership.sweetId);
    }
    void setHouseholdSetupStep(null);
  }, [resumeExistingHousehold, targetMembership?.sweetId, householdId, switchSweet, setHouseholdSetupStep]);
  const additionalHousehold = params.additional === "1";
  const initialMode = params.mode === "join" ? "join" : "create";
  if (resumeExistingHousehold && !targetMembership) return <View style={{ padding: 24 }}><Text>Choose a household you belong to in Settings, then select Finish setup.</Text></View>;
  if (resumeExistingHousehold && (householdId !== target || !householdSetupDataReady)) return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator accessibilityLabel="Loading household setup" /></View>;
  return (
    <HouseholdSetupScreen
      key={resumeExistingHousehold ? `recovery:${householdId}` : "setup"}
      resumeExistingHousehold={resumeExistingHousehold}
      additionalHousehold={additionalHousehold}
      initialMode={initialMode}
      onCancel={() => router.dismissTo("/settings" as never)}
      onComplete={(destination) => {
        if (destination === "essentials") {
          router.replace("/planning?type=home-checklist" as never);
        } else if (destination === "chore-chart") {
          router.replace("/planning?type=chore-chart" as never);
        } else if (destination === "app") {
          router.dismissTo("/(tabs)" as never);
        } else {
          initialMode === "create"
            ? router.dismissTo("/(tabs)" as never)
            : additionalHousehold
            ? router.dismissTo("/settings" as never)
            : backWithFallback(router, "/(tabs)");
        }
      }}
    />
  );
}
