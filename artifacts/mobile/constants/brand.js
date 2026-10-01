// Brand base colors that native configuration needs. The accent schemes in
// `themeTokens.ts` cover everything JS renders; these two exist because the
// native launch screen is painted by the OS before any JS runs and therefore
// cannot call `useTheme()`.
//
// `BRAND_BASE_DARK` is the mark's own ink color, used as the launch-screen and
// root-view background so the OS never shows a white frame before the app
// paints. `BRAND_MARK_ON_DARK` is the mark color that reads against it, used by
// the generated `sweetmate-splash-on-dark.png` asset.
//
// Plain CommonJS rather than TypeScript so `app.config.ts` can require it —
// Expo's config loader transpiles the config file itself but resolves its
// imports through Node.

const BRAND_BASE_DARK = "#111111";
const BRAND_MARK_ON_DARK = "#FFFFFF";

module.exports = { BRAND_BASE_DARK, BRAND_MARK_ON_DARK };
