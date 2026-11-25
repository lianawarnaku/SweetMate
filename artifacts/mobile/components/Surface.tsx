import type { ComponentProps } from "react";

import { GlassSurface } from "@/components/LiquidGlass";
import type { GlassLevel } from "@/constants/designTokens";

type SurfaceProps = Omit<ComponentProps<typeof GlassSurface>, "material"> & { level?: GlassLevel };

/** Content cards and sheets stay solid; button controls opt into glass separately. */
export function Surface({ level = "card", variant, ...props }: SurfaceProps) {
  const resolvedVariant = variant ?? (level === "card" ? "regular" : level);
  return <GlassSurface {...props} variant={resolvedVariant} material="solid" />;
}
