/**
 * Semantic UI tokens for SweetMate.
 *
 * Keep raw values here and consume them by meaning in components. This makes
 * the visual system adjustable without hunting through individual screens.
 */
export const spacing = {
  hairline: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radii = {
  small: 10,
  control: 14,
  card: 22,
  floating: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 40, lineHeight: 42, fontFamily: "Inter_700Bold" },
  title: { fontSize: 28, lineHeight: 32, fontFamily: "Inter_700Bold" },
  heading: { fontSize: 20, lineHeight: 24, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_400Regular" },
  label: { fontSize: 15, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  caption: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_500Medium" },
} as const;

export const motion = {
  quick: 120,
  standard: 220,
  deliberate: 360,
  spring: { damping: 22, stiffness: 240, mass: 0.72 },
} as const;

export const interaction = {
  minimumTouchTarget: 44,
  comfortableTouchTarget: 50,
  pressedScale: 0.985,
  disabledOpacity: 0.42,
} as const;

export const glass = {
  subtle: {
    blurIntensity: 22,
    darkTint: "rgba(255,255,255,0.045)",
    lightTint: "rgba(255,255,255,0.58)",
    borderColor: "rgba(255,255,255,0.08)",
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  card: {
    blurIntensity: 40,
    darkTint: "rgba(255,255,255,0.08)",
    lightTint: "rgba(255,255,255,0.76)",
    borderColor: "rgba(255,255,255,0.14)",
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  elevated: {
    blurIntensity: 58,
    darkTint: "rgba(255,255,255,0.11)",
    lightTint: "rgba(255,255,255,0.84)",
    borderColor: "rgba(255,255,255,0.2)",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  modal: {
    blurIntensity: 76,
    darkTint: "rgba(18,20,21,0.7)",
    lightTint: "rgba(255,252,248,0.7)",
    borderColor: "rgba(255,255,255,0.22)",
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 18,
  },
} as const;

export type GlassLevel = keyof typeof glass;
