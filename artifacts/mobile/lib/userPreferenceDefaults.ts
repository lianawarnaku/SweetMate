import {
  normalizeColorScheme,
  normalizeAppearanceMode,
  type AppearanceMode,
  type ColorScheme,
} from "../constants/themeTokens.ts";

export const USER_PREFERENCES_VERSION = 3;

export interface StoredDisplayPreferences {
  colorScheme?: unknown;
  appearanceMode?: unknown;
  pointsEnabled?: boolean;
  roommateActivityEnabled?: boolean;
  plantEnabled?: boolean;
  preferencesVersion?: number;
}

export interface ResolvedDisplayPreferences {
  colorScheme: ColorScheme;
  appearanceMode: AppearanceMode;
  pointsEnabled: boolean;
  roommateActivityEnabled: boolean;
  plantEnabled: boolean;
  preferencesVersion: number;
}

export function resolveDisplayPreferenceDefaults(
  stored: StoredDisplayPreferences,
): ResolvedDisplayPreferences {
  return {
    colorScheme: normalizeColorScheme(stored.colorScheme),
    appearanceMode: normalizeAppearanceMode(stored.appearanceMode),
    pointsEnabled:
      typeof stored.pointsEnabled === "boolean" ? stored.pointsEnabled : false,
    roommateActivityEnabled:
      typeof stored.roommateActivityEnabled === "boolean"
        ? stored.roommateActivityEnabled
        : false,
    plantEnabled:
      typeof stored.plantEnabled === "boolean" ? stored.plantEnabled : true,
    preferencesVersion: USER_PREFERENCES_VERSION,
  };
}
