import React, { useEffect, useState } from "react";
import { AppState, Text } from "react-native";
import { useTheme } from "@/constants/colors";

export function BusyScheduleStatus({ endsAt, timezone }: { endsAt: string; timezone: string }) {
  const colors = useTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setTimeout(update, Math.min(2_147_483_647, Math.max(10, Date.parse(endsAt) - Date.now() + 10)));
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearTimeout(timer); listener.remove(); };
  }, [endsAt]);
  if (Date.parse(endsAt) <= now) return null;
  return <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 16, color: colors.mutedForeground, textAlign: "center" }}>
    Busy until {new Date(endsAt).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" })}
  </Text>;
}
