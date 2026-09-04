import React from "react";
import Svg, { G, Path, Rect } from "react-native-svg";

type Props = {
  health: number;
  size?: number;
  activeColor: string;
  inactiveColor: string;
};

const ROOF =
  "M45.5,18.5 L19.5,41.6 Q14.5,46 21,46 H79 Q85.5,46 80.5,41.6 L54.5,18.5 Q50,14.5 45.5,18.5 Z";

/**
 * Five-field house meter. Each field can be partially highlighted, so the
 * combined highlight is directly proportional to the completed-chore ratio.
 */
export function RoomHealthMonitor({
  health,
  size = 130,
  activeColor,
  inactiveColor,
}: Props) {
  const progress = Math.max(0, Math.min(1, health));
  const fieldFill = (index: number) =>
    Math.max(0, Math.min(1, progress * 5 - index));

  const fields = [
    <Rect key="bottom-left" x={27} y={72} width={22} height={22} rx={11} />,
    <Rect key="bottom-right" x={51} y={72} width={22} height={22} rx={11} />,
    <Rect key="top-left" x={27} y={48} width={22} height={22} rx={11} />,
    <Rect key="top-right" x={51} y={48} width={22} height={22} rx={11} />,
    <Path key="roof" d={ROOF} />,
  ];

  return (
    <Svg width={size} height={size * 1.08} viewBox="0 0 100 108">
      <G fill={inactiveColor}>{fields}</G>
      {fields.map((field, index) => (
        <G key={`active-${index}`} fill={activeColor} opacity={fieldFill(index)}>
          {field}
        </G>
      ))}
    </Svg>
  );
}
