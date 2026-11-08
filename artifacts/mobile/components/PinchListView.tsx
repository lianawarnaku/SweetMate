import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { Gesture } from "react-native-gesture-handler";

import { resolvePinchView } from "@/lib/pinchListView";

const preferenceKey = (userId: string, screen: string) =>
  `sweetmate:pinch-list-view:v1:${userId}:${screen}`;

export function usePinchListView(userId: string, screen: "home" | "group") {
  const [listView, setListView] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    AsyncStorage.getItem(preferenceKey(userId, screen))
      .then((storedView) => {
        if (active) setListView(storedView === "list");
      })
      .catch(() => {
        // Keep the current view if the saved preference is unavailable.
      });
    return () => {
      active = false;
    };
  }, [screen, userId]);

  const selectView = (nextListView: boolean) => {
    setListView(nextListView);
    void AsyncStorage.setItem(
      preferenceKey(userId, screen),
      nextListView ? "list" : "timeline",
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onEnd(({ scale }) => {
          const next = resolvePinchView(scale, listView ? "list" : "dashboard");
          if (next !== (listView ? "list" : "dashboard")) {
            selectView(next === "list");
          }
        })
        .runOnJS(true),
    [listView, screen, userId],
  );

  return { listView, pinchGesture };
}
