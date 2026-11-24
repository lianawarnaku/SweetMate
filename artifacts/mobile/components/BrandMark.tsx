import Svg, { Path, Rect } from "react-native-svg";
import {
  HOUSE_MONITOR_BODY_SIZE,
  HOUSE_MONITOR_ROOF_HEIGHT,
  HOUSE_MONITOR_ROOF_PATH,
  HOUSE_MONITOR_ROOF_TRANSFORM,
  HOUSE_MONITOR_ROOF_WIDTH,
} from "@/lib/houseMonitorRoof";

export const HOMIE_MARK_DEFAULT = "#111111";

export function BrandMark({
  size = 180,
  color,
}: {
  size?: number;
  color?: string;
  transition?: boolean;
}) {
  // A flat fill rather than a gradient: all three stops were the same color,
  // and one hardcoded gradient id is shared by every instance — two marks on
  // screen at once (sign-in behind the loader) collide, and Android resolves
  // the reference to whichever definition it saw last.
  const fill = color ?? HOMIE_MARK_DEFAULT;

  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Path
        d="M128 35c4.3 0 8.3 1.7 11.4 4.7l82.8 80.6c5.4 5.3 1.7 14.5-5.9 14.5H39.7c-7.6 0-11.3-9.2-5.9-14.5l82.8-80.6c3.1-3 7.1-4.7 11.4-4.7Z"
        fill={fill}
      />
      <Rect x="64" y="139" width="58" height="52" rx="13" fill={fill} />
      <Rect x="134" y="139" width="58" height="52" rx="13" fill={fill} />
      <Rect x="64" y="198" width="58" height="52" rx="13" fill={fill} />
      <Rect x="134" y="198" width="58" height="52" rx="13" fill={fill} />
    </Svg>
  );
}

/** A single square beneath the Group monitor's rounded triangular roof. */
export function MiniHouseMark({ size = 28, color = HOMIE_MARK_DEFAULT }: { size?: number; color?: string }) {
  const bodyY = HOUSE_MONITOR_ROOF_HEIGHT + 10;
  const height = bodyY + HOUSE_MONITOR_BODY_SIZE;
  return (
    <Svg accessible={false} width={size * HOUSE_MONITOR_ROOF_WIDTH / height} height={size}
      viewBox={`0 0 ${HOUSE_MONITOR_ROOF_WIDTH} ${height}`} fill="none">
      <Path d={HOUSE_MONITOR_ROOF_PATH} transform={HOUSE_MONITOR_ROOF_TRANSFORM} fill={color} />
      <Rect x={(HOUSE_MONITOR_ROOF_WIDTH - HOUSE_MONITOR_BODY_SIZE) / 2} y={bodyY}
        width={HOUSE_MONITOR_BODY_SIZE} height={HOUSE_MONITOR_BODY_SIZE} rx={13} fill={color} />
    </Svg>
  );
}
