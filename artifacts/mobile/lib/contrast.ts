/** Convert theme hex colors to translucent Android ripple colors. */
export function withAlpha(color: string, alpha: number): string {
  let hex = color.replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((digit) => digit + digit).join("");
  if (hex.length === 8) hex = hex.slice(0, 6);
  const opacity = Math.min(1, Math.max(0, alpha));
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(0, 0, 0, ${opacity})`;
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${rgb.join(", ")}, ${opacity})`;
}
