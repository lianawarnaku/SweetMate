import { HouseholdSetupScreen } from "@/components/HouseholdSetupScreen";
import { router, useLocalSearchParams } from "expo-router";

export default function SweetSetupRoute() {
  const params = useLocalSearchParams<{ mode?: string; additional?: string }>();
  const additionalHousehold = params.additional === "1";
  const initialMode = params.mode === "join" ? "join" : "create";
  return (
    <HouseholdSetupScreen
      additionalHousehold={additionalHousehold}
      initialMode={initialMode}
      onComplete={(destination) => {
        if (destination === "essentials") {
          router.replace("/planning?type=home-checklist" as never);
        } else {
          additionalHousehold
            ? router.replace("/settings" as never)
            : router.back();
        }
      }}
    />
  );
}
