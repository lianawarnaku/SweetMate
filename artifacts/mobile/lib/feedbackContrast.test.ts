import {
  resolveThemeTokens,
  type ColorScheme,
} from "../constants/themeTokens.ts";
function rgb(color: string): number[] {
  if (color.startsWith("#"))
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return color.match(/[\d.]+/g)!.map(Number);
}
function composite(foreground: string, background: number[]): number[] {
  const color = rgb(foreground);
  const alpha = color[3] ?? 1;
  return color
    .slice(0, 3)
    .map((value, i) => value * alpha + background[i] * (1 - alpha));
}
function luminance(color: number[]) {
  return color
    .map((value) => value / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function check(label: string, foreground: string, background: number[]) {
  const a = luminance(composite(foreground, background));
  const b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio < 4.5) throw Error(`${label}: ${ratio.toFixed(2)}:1`);
}
for (const mode of ["light", "dark"] as const)
  for (const scheme of [
    "mono",
    "brown",
    "pinkWhite",
    "blueWhite",
  ] as ColorScheme[]) {
    const t = resolveThemeTokens(mode, scheme);
    const base = rgb(t.background);
    check(`${mode}/${scheme} action`, t.actionForeground, rgb(t.action));
    check(
      `${mode}/${scheme} destructive action`,
      t.destructiveForeground,
      rgb(t.destructive),
    );
    for (const [name, surface] of [
      ["card", t.card],
      ["sheet", t.surfaceModal],
    ] as const) {
      const background = composite(surface, base);
      check(`${mode}/${scheme}/${name} text`, t.foreground, background);
      check(
        `${mode}/${scheme}/${name} secondary text`,
        t.mutedForeground,
        background,
      );
    }
  }
console.log("Feedback contrast passed in all light/dark themes.");
