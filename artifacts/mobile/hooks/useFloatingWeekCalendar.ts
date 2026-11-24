import { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Easing, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { boundedCalendarScrollOffset, initialCalendarScrollIntent, nextCalendarScrollIntent } from "@/lib/floatingCalendarScroll";

export function useFloatingWeekCalendar({ enabled, reduceMotion, resetKey }: {
  enabled: boolean;
  reduceMotion: boolean;
  resetKey: string;
}) {
  const [height, setHeight] = useState(190);
  const [hidden, setHidden] = useState(false);
  const measuredHeight = useSharedValue(190);
  const scrollY = useSharedValue(0);
  const intent = useSharedValue(initialCalendarScrollIntent());
  const progress = useSharedValue(0);

  useEffect(() => {
    intent.value = initialCalendarScrollIntent(scrollY.value);
    progress.value = 0;
    setHidden(false);
  }, [enabled, resetKey, intent, progress, scrollY]);

  const onScroll = useAnimatedScrollHandler((event) => {
    const offset = boundedCalendarScrollOffset(event.contentOffset.y, event.contentSize.height, event.layoutMeasurement.height);
    scrollY.value = offset;
    if (!enabled) {
      intent.value = initialCalendarScrollIntent(offset);
      return;
    }
    const previous = intent.value;
    const next = nextCalendarScrollIntent(previous, offset, measuredHeight.value);
    intent.value = next;
    if (next.hidden !== previous.hidden) {
      progress.value = reduceMotion ? Number(next.hidden) : withTiming(Number(next.hidden), {
        duration: next.hidden ? 360 : 260,
        easing: next.hidden ? Easing.inOut(Easing.cubic) : Easing.out(Easing.cubic),
      });
      runOnJS(setHidden)(next.hidden);
    }
  }, [enabled, reduceMotion]);

  const floatingStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion && intent.value.hidden ? 0 : 1,
    transform: [{ translateY: reduceMotion ? 0 : -progress.value * (measuredHeight.value + 16) }],
  }), [reduceMotion]);

  const onCalendarLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight <= 0) return;
    measuredHeight.value = nextHeight;
    setHeight((current) => Math.abs(current - nextHeight) >= 1 ? nextHeight : current);
  };

  return {
    onScroll, floatingStyle, height, hidden, onCalendarLayout,
  };
}
