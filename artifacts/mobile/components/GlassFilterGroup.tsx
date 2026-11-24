import React, { Children, createContext, isValidElement, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { GlassControlSurface } from "@/components/GlassControlSurface";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";

const GroupContext = createContext(false);
export function useGlassFilterGroup() { return useContext(GroupContext); }

type Frame = { x: number; width: number };

/** Measures each option so the selection follows translated and scaled labels. */
export function GlassFilterGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useTheme();
  const { reduceMotion } = useAccessibilityPreferences();
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{ selected?: boolean }>[];
  const selected = options.findIndex(option => option.props.selected);
  const selectedKey = selected < 0 ? "" : String(options[selected].key ?? selected);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const target = frames[selectedKey];
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const positioned = useRef(false);

  useEffect(() => {
    if (!target) return;
    if (!positioned.current || reduceMotion) {
      x.setValue(target.x); width.setValue(target.width); positioned.current = true;
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(x, { toValue: target.x, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(width, { toValue: target.width, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [target?.x, target?.width, reduceMotion, x, width]);

  return <GroupContext.Provider value>
    <View accessibilityRole="tablist" style={[styles.group, style]}>
      <GlassControlSurface pointerEvents="none" style={StyleSheet.absoluteFill} />
      {target && <Animated.View pointerEvents="none" style={[styles.indicator, {
        backgroundColor: colors.mode === "dark" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.90)",
        borderColor: colors.glassRim, left: x, width,
      }]} />}
      {options.map((option, index) => {
        const key = String(option.key ?? index);
        return <View key={key} style={styles.option} onLayout={({ nativeEvent: { layout } }) => {
          setFrames(previous => previous[key]?.x === layout.x && previous[key]?.width === layout.width
            ? previous : { ...previous, [key]: { x: layout.x, width: layout.width } });
        }}>{option}</View>;
      })}
    </View>
  </GroupContext.Provider>;
}

const styles = StyleSheet.create({
  group: { alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", alignItems: "center", padding: 4, gap: 2, borderRadius: 26 },
  option: { flexShrink: 1, minWidth: 44 },
  indicator: { position: "absolute", top: 4, bottom: 4, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
});
