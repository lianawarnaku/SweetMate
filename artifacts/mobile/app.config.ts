// Layers the brand launch-screen colors onto `app.json`.
//
// `app.json` stays the base config (server/serve.js also reads the app name
// from it); this file only injects the colors that must not live as literals —
// see `constants/brand.js`. Expo loads app.config.ts in preference to app.json
// and hands the JSON contents in as `config`.

import type { ConfigContext, ExpoConfig } from "expo/config";

import { BRAND_BASE_DARK } from "./constants/brand";

type PluginEntry = NonNullable<ExpoConfig["plugins"]>[number];
type SplashOptions = {
  image?: string;
  dark?: { image?: string; backgroundColor?: string };
  [key: string]: unknown;
};

// app.json supplies an explicitly transparent launch image to avoid the native
// app-icon fallback. The black native frame then matches the first JS frame
// before its white house pieces animate in. Both native appearance modes must
// use this same image and background.
function withBrandSplash(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  const brandBackgrounds = (existing: SplashOptions): SplashOptions => ({
    ...existing,
    backgroundColor: BRAND_BASE_DARK,
    dark: {
      ...existing.dark,
      image: existing.dark?.image ?? existing.image,
      backgroundColor: BRAND_BASE_DARK,
    },
  });

  let sawSplashPlugin = false;
  const rewritten: PluginEntry[] = (plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== "expo-splash-screen") return plugin;
    sawSplashPlugin = true;
    const existing = (Array.isArray(plugin) ? plugin[1] : undefined) as SplashOptions | undefined;
    return ["expo-splash-screen", brandBackgrounds(existing ?? {})];
  });

  return sawSplashPlugin
    ? rewritten
    : [...rewritten, ["expo-splash-screen", brandBackgrounds({})]];
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: withBrandSplash(config.plugins),
  // The OS paints these behind the launch screen and behind the root view
  // before the first JS frame, so they must already be the brand dark base
  // rather than the platform default white.
  backgroundColor: BRAND_BASE_DARK,
  ios: { ...config.ios, backgroundColor: BRAND_BASE_DARK },
  android: { ...config.android, backgroundColor: BRAND_BASE_DARK },
});
