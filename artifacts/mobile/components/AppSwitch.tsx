import React from "react";
import { Platform, Switch, type SwitchProps } from "react-native";
import { useTheme } from "@/constants/colors";

/** Consistent neutral switches across settings, privacy and borrowing. */
export function AppSwitch(props: SwitchProps) {
  const colors = useTheme();
  return (
    <Switch
      {...props}
      {...(Platform.OS === "web" ? { activeThumbColor: "#FFFFFF" } : {})}
      trackColor={{ false: colors.border, true: "#71717A" }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={colors.border}
    />
  );
}
