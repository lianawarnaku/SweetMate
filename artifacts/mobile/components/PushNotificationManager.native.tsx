import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useAppContextSelector } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import { registerPushDevice, unregisterPushDevice } from "@/lib/pushRegistration";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

Notifications.setNotificationHandler({ handleNotification: async () => ({
  // The existing NudgeToast is the foreground presentation.
  shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
}) });
export function PushNotificationManager({ userId }: { userId: string | null }) {
  const switchSweet = useAppContextSelector(context => context.switchSweet);
  useEffect(() => {
    if (!userId || !Device.isDevice) return;
    let active = true;
    let busy = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const register = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("nudges", {
          name: "Chore nudges", importance: Notifications.AndroidImportance.DEFAULT,
        });
        let permission = await Notifications.getPermissionsAsync();
        if (permission.status === "undetermined" && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
        if (!active) return;
        if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
          await unregisterPushDevice(); return;
        }
        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) throw new Error("Push project configuration is missing.");
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (active) await registerPushDevice(userId, token, Platform.OS);
      } catch (error) {
        reportRuntimeError("register nudge notifications", error);
        if (active) retry = setTimeout(() => { void register(); }, 60000);
      } finally { busy = false; }
    };
    let handled: string | undefined;
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response || !active) return;
      const id = response.notification.request.identifier;
      const data = response.notification.request.content.data;
      if (id === handled || data.type !== "nudge" || typeof data.nudgeId !== "string") return;
      // Confirm this signed-in user owns the alert; never route arbitrary payload URLs.
      const { data: nudge, error } = await supabase.from("nudges").select("id,to_member_id,household_id")
        .eq("id", data.nudgeId).eq("to_member_id", userId).maybeSingle();
      if (error || !active || !nudge) return;
      handled = id;
      switchSweet(nudge.household_id);
      router.push({ pathname: "/(tabs)/group", params: { nudgeId: nudge.id } });
      await Notifications.clearLastNotificationResponseAsync();
    };
    void register();
    void Notifications.getLastNotificationResponseAsync().then(open).catch(error => reportRuntimeError("open nudge notification", error));
    const tokenListener = Notifications.addPushTokenListener(() => { void register(); });
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => { void open(response).catch(error => reportRuntimeError("open nudge notification", error)); });
    const appListener = AppState.addEventListener("change", state => { if (state === "active") void register(); });
    return () => { active = false; clearTimeout(retry); tokenListener.remove(); responseListener.remove(); appListener.remove(); };
  }, [userId, switchSweet]);
  return null;
}
