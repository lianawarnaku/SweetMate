import { useModalDismissal } from "@/hooks/useModalDismissal";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, PanResponder } from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const PARTIAL_OFFSET = SCREEN_HEIGHT * 0.4;
const DISMISS_OFFSET = SCREEN_HEIGHT * 0.7;

/** Adds expanded, partial, and dismissed snap behavior to a vertical sheet. */
export function useDraggableSheet(
  translateY: Animated.Value,
  onDismiss: () => void,
  visible = true,
) {
  const dismissRef = useRef(onDismiss);
  const modalDismissal = useModalDismissal(visible, () => dismissRef.current());
  const dragStartRef = useRef(0);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          modalDismissal.cancel();
          translateY.stopAnimation((value) => {
            dragStartRef.current = value;
          });
        },
        onPanResponderMove: (_, gesture) => {
          const next = Math.max(
            0,
            Math.min(SCREEN_HEIGHT, dragStartRef.current + gesture.dy)
          );
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          const projected =
            dragStartRef.current + gesture.dy + gesture.vy * 110;
          if (projected >= DISMISS_OFFSET) {
            modalDismissal.dismiss(Animated.timing(translateY, {
              toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true,
            }), 220);
            return;
          }

          const snapPoint = projected >= SCREEN_HEIGHT * 0.18 ? PARTIAL_OFFSET : 0;
          Animated.spring(translateY, {
            toValue: snapPoint,
            damping: 20,
            stiffness: 190,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: dragStartRef.current >= SCREEN_HEIGHT * 0.18 ? PARTIAL_OFFSET : 0,
            damping: 20,
            stiffness: 190,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
      }).panHandlers,
    [translateY, modalDismissal.dismiss, modalDismissal.cancel]
  );
}
