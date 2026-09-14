export type AppearanceMode = "light" | "dark";

type AccentPalette = {
  text: string; tint: string; background: string; foreground: string;
  card: string; cardForeground: string; primary: string; primaryForeground: string;
  action: string; actionForeground: string;
  secondary: string; secondaryForeground: string; muted: string; mutedForeground: string;
  accent: string; accentForeground: string; destructive: string; destructiveForeground: string;
  success: string; warning: string; border: string; input: string; radius: number;
};

const mono: AccentPalette = {
  text: "#F5F5F7", tint: "#F2F2F5", background: "#000000", foreground: "#F5F5F7",
  card: "rgba(255,255,255,0.08)", cardForeground: "#F5F5F7", primary: "#F2F2F5",
  primaryForeground: "#111114", action: "#F2F2F5", actionForeground: "#111114",
  secondary: "rgba(255,255,255,0.12)", secondaryForeground: "#F5F5F7",
  muted: "rgba(255,255,255,0.06)", mutedForeground: "#9A9AA2", accent: "rgba(255,255,255,0.16)",
  accentForeground: "#FFFFFF", destructive: "#FF453A", destructiveForeground: "#FFFFFF",
  success: "#32D74B", warning: "#C7C7CC", border: "rgba(255,255,255,0.14)",
  input: "rgba(255,255,255,0.14)", radius: 22,
};
const brown: AccentPalette = {
  text: "#33261D", tint: "#8B6F52", background: "#F7F1E8", foreground: "#33261D",
  card: "#FFFCF7", cardForeground: "#33261D", primary: "#8B6F52", primaryForeground: "#FFFFFF",
  action: "#8B6F52", actionForeground: "#FFFFFF",
  secondary: "#EDE1D3", secondaryForeground: "#60422F", muted: "#EEE5DA", mutedForeground: "#806B5A",
  accent: "#B98355", accentForeground: "#FFFFFF", destructive: "#C44545", destructiveForeground: "#FFFFFF",
  success: "#7B9C6F", warning: "#D9A24E", border: "#DDCDBD", input: "#DDCDBD", radius: 22,
};
const pinkWhite: AccentPalette = {
  text: "#35272D", tint: "#F48FB1", background: "#FFF7FA", foreground: "#35272D",
  card: "#FFFFFF", cardForeground: "#35272D", primary: "#F48FB1", primaryForeground: "#FFFFFF",
  action: "#F48FB1", actionForeground: "#FFFFFF",
  secondary: "#FDE7EF", secondaryForeground: "#9A4563", muted: "#F7EDF1", mutedForeground: "#806A73",
  accent: "#E96C99", accentForeground: "#FFFFFF", destructive: "#C9455D", destructiveForeground: "#FFFFFF",
  success: "#68A47B", warning: "#D99A45", border: "#EED8E1", input: "#EED8E1", radius: 22,
};
const blueWhite: AccentPalette = {
  text: "#142A3C", tint: "#1E3F5A", background: "#F8FBFD", foreground: "#111827",
  card: "#FFFFFF", cardForeground: "#111827", primary: "#1E3F5A", primaryForeground: "#FFFFFF",
  action: "#1E3F5A", actionForeground: "#FFFFFF",
  secondary: "#E8F0F5", secondaryForeground: "#1E3F5A", muted: "#EFF4F7", mutedForeground: "#566774",
  accent: "#315F73", accentForeground: "#FFFFFF", destructive: "#B9363E", destructiveForeground: "#FFFFFF",
  success: "#27864B", warning: "#B87512", border: "#CBD8E0", input: "#CBD8E0", radius: 22,
};

export const colorSchemes = { mono, brown, pinkWhite, blueWhite } as const;
export type ColorScheme = keyof typeof colorSchemes;

function parseHex(color: string) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  return match ? [1, 2, 3].map((index) => Number.parseInt(match[index], 16)) : null;
}

function blendHex(from: string, toward: string, amount: number) {
  const start = parseHex(from);
  const end = parseHex(toward);
  if (!start || !end) return from;
  const channel = (index: number) => Math.round(start[index] + (end[index] - start[index]) * amount)
    .toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export function normalizeColorScheme(value: unknown): ColorScheme {
  if (value === "blue") return "blueWhite";
  return typeof value === "string" && value in colorSchemes ? value as ColorScheme : "mono";
}

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return value === "light" ? "light" : "dark";
}

export function resolveThemeTokens(mode: AppearanceMode, scheme: ColorScheme) {
  const palette = colorSchemes[scheme];
  const dark = mode === "dark";
  const darkAnchor = "#121214";
  const lightAnchor = "#FAFAFC";
  const accent = scheme === "mono"
    ? (dark ? "#F2F2F5" : "#1A1A1D")
    : blendHex(palette.primary, dark ? lightAnchor : darkAnchor, dark ? 0.14 : 0.18);
  const accentSecond = scheme === "mono"
    ? (dark ? "#C9C9CF" : "#45454B")
    : blendHex(accent, dark ? lightAnchor : darkAnchor, dark ? 0.18 : 0.12);
  const surfaceSubtle = dark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.44)";
  const surface = dark ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.64)";
  const surfaceElevated = dark ? "rgba(30,30,33,0.76)" : "rgba(255,255,255,0.84)";
  const surfaceModal = dark ? "rgba(24,24,27,0.96)" : "rgba(248,248,251,0.96)";
  const textPrimary = dark ? "#F5F5F7" : "#1A1A1D";
  const textSecondary = dark ? "rgba(255,255,255,0.60)" : "rgba(0,0,0,0.55)";
  const divider = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)";
  const destructive = dark ? "#FF5A65" : "#C93444";
  const background = dark ? "#070708" : "#F4F4F7";

  return {
    mode, surfaceSubtle, surface, surfaceElevated, surfaceModal, textPrimary, textSecondary, divider, accent,
    accentGradient: [accent, accentSecond] as readonly [string, string],
    accentGlow: accent, accentGlowOpacity: dark ? 0.34 : 0.2, destructive,
    destructiveSurface: dark ? "rgba(49,27,31,0.96)" : "rgba(255,240,242,0.96)",
    glassRim: divider,
    glassHighlight: "transparent",
    backdrop: dark ? "rgba(0,0,0,0.48)" : "rgba(10,10,14,0.30)",
    text: textPrimary, tint: accent, background, foreground: textPrimary, card: surface,
    cardForeground: textPrimary, primary: accent,
    primaryForeground: dark && scheme === "mono" ? "#111114" : "#FFFFFF",
    action: accent,
    actionForeground: dark && scheme === "mono" ? "#111114" : "#FFFFFF",
    secondary: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
    secondaryForeground: textPrimary, muted: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
    mutedForeground: textSecondary, accentForeground: dark && scheme === "mono" ? "#111114" : "#FFFFFF",
    destructiveForeground: "#FFFFFF", success: dark ? "#4BD56B" : "#237A42",
    warning: dark ? "#F2B84B" : "#9A6108", border: divider,
    input: dark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.08)", radius: palette.radius,
  };
}

export type ThemeTokens = ReturnType<typeof resolveThemeTokens>;
