import { useCallback, useEffect, useRef } from "react";
import { Platform, type Animated } from "react-native";

/** Close once even if a native animation is interrupted or never calls back. */
export function useModalDismissal(visible: boolean, onClose: () => void) {
  const generation = useRef(0);
  const closing = useRef(false);
  const visibleRef = useRef(visible);
  const closeRef = useRef(onClose);
  visibleRef.current = visible;
  closeRef.current = onClose;
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoff = useRef<{ generation: number; action: () => void } | null>(null);

  const cancel = useCallback(() => {
    generation.current++;
    closing.current = false;
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    if (handoffTimer.current !== null) clearTimeout(handoffTimer.current);
    exitTimer.current = handoffTimer.current = null;
    handoff.current = null;
  }, []);
  const onDismiss = useCallback(() => {
    if (visibleRef.current) return;
    const pending = handoff.current;
    if (!pending || pending.generation !== generation.current) return;
    handoff.current = null;
    if (handoffTimer.current !== null) clearTimeout(handoffTimer.current);
    handoffTimer.current = null;
    pending.action();
  }, []);

  useEffect(() => {
    if (visible) cancel();
    else {
      if (exitTimer.current !== null) cancel();
      if (!handoff.current) return;
      // iOS reports when its native presentation is gone. Android/web have
      // removed it in this commit. The fallback also covers a lost iOS event.
      handoffTimer.current = setTimeout(onDismiss, Platform.OS === "ios" ? 450 : 0);
    }
  }, [visible, cancel, onDismiss]);
  useEffect(() => cancel, [cancel]);

  const dismiss = useCallback((animation?: Animated.CompositeAnimation, duration = 0, afterDismiss?: () => void) => {
    if (closing.current || !visibleRef.current) return;
    closing.current = true;
    const request = generation.current;
    let committed = false;
    const complete = () => {
      if (committed || request !== generation.current) return;
      committed = true;
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
      exitTimer.current = null;
      if (afterDismiss) handoff.current = { generation: request, action: afterDismiss };
      closeRef.current();
    };
    if (!animation) { complete(); return; }
    exitTimer.current = setTimeout(complete, Math.max(0, duration) + 100);
    try { animation.start(complete); } catch { complete(); }
  }, []);

  return { dismiss, onDismiss, cancel };
}
