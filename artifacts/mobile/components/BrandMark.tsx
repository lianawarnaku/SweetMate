import React, { useContext, useRef } from "react";
import { View } from "react-native";
import { HouseTransitionContext } from "./HouseTransitionContext";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export const HOMIE_MARK_DEFAULT = "#111111";

export function BrandMark({
  size = 180,
  color,
  transition = false,
}: {
  size?: number;
  color?: string;
  transition?: boolean;
}) {
  const reportTarget = useContext(HouseTransitionContext);
  const anchor = useRef<View>(null);
  if (reportTarget && transition) {
    return <View ref={anchor} collapsable={false} style={{ width: size, height: size }} onLayout={() => {
      anchor.current?.measureInWindow((x, y) => reportTarget({ x, y, size }));
    }} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Defs>
        <LinearGradient id="homieMark" x1="42" y1="28" x2="218" y2="232">
          <Stop offset="0" stopColor={color ?? HOMIE_MARK_DEFAULT} />
          <Stop offset="0.55" stopColor={color ?? HOMIE_MARK_DEFAULT} />
          <Stop offset="1" stopColor={color ?? HOMIE_MARK_DEFAULT} />
        </LinearGradient>
      </Defs>
      <Path
        d="M128 35c4.3 0 8.3 1.7 11.4 4.7l82.8 80.6c5.4 5.3 1.7 14.5-5.9 14.5H39.7c-7.6 0-11.3-9.2-5.9-14.5l82.8-80.6c3.1-3 7.1-4.7 11.4-4.7Z"
        fill="url(#homieMark)"
      />
      <Rect x="64" y="139" width="58" height="52" rx="13" fill="url(#homieMark)" />
      <Rect x="134" y="139" width="58" height="52" rx="13" fill="url(#homieMark)" />
      <Rect x="64" y="198" width="58" height="52" rx="13" fill="url(#homieMark)" />
      <Rect x="134" y="198" width="58" height="52" rx="13" fill="url(#homieMark)" />
    </Svg>
  );
}
