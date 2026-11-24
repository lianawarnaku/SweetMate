import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { connectGoogleCalendar, disconnectGoogleCalendar, isGoogleCalendarConnected } from "@/lib/googleCalendarConnection";
import { createCalendarConnectionStore } from "@/lib/googleCalendarConnectionStore";

const connectionStore = createCalendarConnectionStore({
  check: isGoogleCalendarConnected,
  connect: connectGoogleCalendar,
  disconnect: disconnectGoogleCalendar,
});

export function useGoogleCalendarConnection(userId: string | null) {
  const subscribe = useCallback((listener: () => void) => connectionStore.subscribe(userId, listener), [userId]);
  const getSnapshot = useCallback(() => connectionStore.getSnapshot(userId), [userId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(() => userId ? connectionStore.refresh(userId) : Promise.resolve(false), [userId]);
  useFocusEffect(useCallback(() => { void refresh().catch(() => {}); }, [refresh]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [refresh]);
  return {
    ...snapshot,
    refresh,
    connect: useCallback(() => userId ? connectionStore.connect(userId) : Promise.reject(new Error("Sign in before connecting Google Calendar.")), [userId]),
    disconnect: useCallback(() => userId ? connectionStore.disconnect(userId) : Promise.reject(new Error("Sign in before disconnecting Google Calendar.")), [userId]),
  };
}
