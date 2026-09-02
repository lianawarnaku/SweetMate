import { useAppContextSelector } from "@/context/AppContext";
import {
  colorSchemes,
  resolveThemeTokens,
  type ThemeTokens,
} from "@/constants/themeTokens";

export {
  colorSchemes,
  normalizeAppearanceMode,
  normalizeColorScheme,
  resolveThemeTokens,
  type AppearanceMode,
  type ColorScheme,
  type ThemeTokens,
} from "@/constants/themeTokens";

export function useTheme(): ThemeTokens {
  const { colorScheme, appearanceMode } = useAppContextSelector((context) => ({
    colorScheme: context.colorScheme,
    appearanceMode: context.appearanceMode,
  }));
  return resolveThemeTokens(appearanceMode, colorScheme);
}
