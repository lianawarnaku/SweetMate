import type { ComponentProps } from "react";

import { GlassSurface } from "@/components/LiquidGlass";
import type { GlassLevel } from "@/constants/designTokens";

type SurfaceProps = ComponentProps<typeof GlassSurface> & { level?: GlassLevel };

export function Surface({ level = "card", variant, ...props }: SurfaceProps) {
  const resolvedVariant = variant ?? (level === "card" ? "regular" : level);
  return <GlassSurface {...props} variant={resolvedVariant} />;
}
