import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { Chore } from "@/context/AppContext";
import {
  completedRetentionBoundary,
  incompleteArchiveBoundary,
} from "@/lib/choreLifecycle";
import { choreNow } from "@/lib/choreClock";

export function useChoreLifecycleNow(chores: Chore[]): Date {
  const [now, setNow] = useState(choreNow);

  useEffect(() => {
    const current = choreNow();
    const nextMidnight = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    );
    const nextLifecycleBoundary = chores.reduce<number | null>((nearest, chore) => {
      const boundaries = [
        completedRetentionBoundary(chore)?.getTime(),
        incompleteArchiveBoundary(chore)?.getTime(),
      ];
      return boundaries.reduce<number | null>((candidate, boundary) => {
        if (!boundary || boundary <= current.getTime()) return candidate;
        return candidate === null || boundary < candidate ? boundary : candidate;
      }, nearest);
    }, null);
    const nextRefresh = Math.min(
      nextMidnight.getTime(),
      nextLifecycleBoundary ?? Number.POSITIVE_INFINITY,
    );
    const timer = setTimeout(
      () => setNow(choreNow()),
      Math.max(1, nextRefresh - current.getTime() + 25),
    );
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(choreNow());
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [chores, now]);

  return now;
}
