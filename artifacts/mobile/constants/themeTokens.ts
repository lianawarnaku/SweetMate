const mono = {
  // Dark, frosted-glass scheme — cards use Surface (expo-blur) instead of a flat fill.
  text: "#F5F5F7",
  tint: "#FFFFFF",
  background: "#000000",
  foreground: "#F5F5F7",
  card: "rgba(255,255,255,0.08)",
  cardForeground: "#F5F5F7",
  primary: "#FFFFFF",
  primaryForeground: "#000000",
  secondary: "rgba(255,255,255,0.12)",
  secondaryForeground: "#F5F5F7",
  muted: "rgba(255,255,255,0.06)",
  mutedForeground: "#9A9AA2",
  accent: "rgba(255,255,255,0.16)",
  accentForeground: "#FFFFFF",
  destructive: "#FF453A",
  destructiveForeground: "#FFFFFF",
  success: "#32D74B",
  warning: "#FFD60A",
  border: "rgba(255,255,255,0.14)",
  input: "rgba(255,255,255,0.14)",
  radius: 22,
} as const;

export type ThemeTokens = {
  [K in keyof typeof mono]: K extends "radius" ? number : string;
};

const brown: ThemeTokens = {
  // TODO: Fine-tune the brown scheme hex values.
  text: "#33261D", tint: "#8B6F52", background: "#F7F1E8",
  foreground: "#33261D", card: "#FFFCF7", cardForeground: "#33261D",
  primary: "#8B6F52", primaryForeground: "#FFFFFF", secondary: "#EDE1D3",
  secondaryForeground: "#60422F", muted: "#EEE5DA", mutedForeground: "#806B5A",
  accent: "#B98355", accentForeground: "#FFFFFF", destructive: "#C44545",
  destructiveForeground: "#FFFFFF", success: "#7B9C6F", warning: "#D9A24E",
  border: "#DDCDBD", input: "#DDCDBD", radius: 22,
};

const pinkWhite: ThemeTokens = {
  // TODO: Fine-tune the pink-white scheme hex values.
  text: "#35272D", tint: "#F48FB1", background: "#FFF7FA",
  foreground: "#35272D", card: "#FFFFFF", cardForeground: "#35272D",
  primary: "#F48FB1", primaryForeground: "#FFFFFF", secondary: "#FDE7EF",
  secondaryForeground: "#9A4563", muted: "#F7EDF1", mutedForeground: "#806A73",
  accent: "#E96C99", accentForeground: "#FFFFFF", destructive: "#C9455D",
  destructiveForeground: "#FFFFFF", success: "#68A47B", warning: "#D99A45",
  border: "#EED8E1", input: "#EED8E1", radius: 22,
};

const blueWhite: ThemeTokens = {
  text: "#142A3C", tint: "#1E3F5A", background: "#F8FBFD",
  foreground: "#111827", card: "#FFFFFF", cardForeground: "#111827",
  primary: "#1E3F5A", primaryForeground: "#FFFFFF", secondary: "#E8F0F5",
  secondaryForeground: "#1E3F5A", muted: "#EFF4F7", mutedForeground: "#566774",
  accent: "#315F73", accentForeground: "#FFFFFF", destructive: "#B9363E",
  destructiveForeground: "#FFFFFF", success: "#27864B", warning: "#B87512",
  border: "#CBD8E0", input: "#CBD8E0", radius: 22,
};

export const colorSchemes = { mono, brown, pinkWhite, blueWhite } as const;
export type ColorScheme = keyof typeof colorSchemes;

export function normalizeColorScheme(value: unknown): ColorScheme {
  if (value === "blue") return "blueWhite";
  return typeof value === "string" && value in colorSchemes
    ? value as ColorScheme
    : "mono";
}
