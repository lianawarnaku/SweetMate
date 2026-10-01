import Svg, { Path, Rect } from "react-native-svg";

export const HOMIE_MARK_DEFAULT = "#111111";

export function BrandMark({
  size = 180,
  color,
}: {
  size?: number;
  color?: string;
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
