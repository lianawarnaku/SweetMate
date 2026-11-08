import { useCallback, useEffect, useRef, useState } from "react";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";

// The row finishes its check, wobble, and departure before the list releases it.
export const COMPLETION_FEEDBACK_MS = 680;
const EMPTY_COMPLETION_IDS = new Set<string>();

export function useCompletionFeedback(scopeKey: string) {
  const { reduceMotion } = useAccessibilityPreferences();
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scope = useRef(scopeKey);

  const cancelCompletion = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setCompletingIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const holdCompletion = useCallback((id: string) => {
    if (reduceMotion) return;
    const previous = timers.current.get(id);
    if (previous) clearTimeout(previous);
    setCompletingIds((current) => new Set(current).add(id));
    timers.current.set(id, setTimeout(() => cancelCompletion(id), COMPLETION_FEEDBACK_MS));
  }, [cancelCompletion, reduceMotion]);

  useEffect(() => {
    scope.current = scopeKey;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setCompletingIds(new Set());
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, [scopeKey, reduceMotion]);

  return {
    completingIds: scope.current === scopeKey && !reduceMotion ? completingIds : EMPTY_COMPLETION_IDS,
    holdCompletion,
    cancelCompletion,
  };
}
