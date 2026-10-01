// Feeds the app's accent scheme into React Navigation's theme. Without this,
// navigation-level containers (the root navigator view, stack scenes, and the
// gap between two screens mid-transition) keep React Navigation's DefaultTheme
// white and flash through on every tab switch.
//
// Must render inside AppProvider — `useTheme()` reads the selected scheme from
// AppContext.

import { DefaultTheme, ThemeProvider, type Theme } from "@react-navigation/native";
import React, { useMemo } from "react";

import { useTheme } from "@/constants/colors";

export function NavigationThemeProvider({ children }: { children: React.ReactNode }) {
  const colors = useTheme();
  const navigationTheme = useMemo<Theme>(
    () => ({
      ...DefaultTheme,
      dark: colors.mode === "dark",
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.border,
        primary: colors.primary,
        notification: colors.destructive,
      },
    }),
    [colors],
  );

  return <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>;
}
