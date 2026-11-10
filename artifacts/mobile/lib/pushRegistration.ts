import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
const KEY = "sweetmate.push.installation.v1";
let queue: Promise<unknown> = Promise.resolve();
let signingOut = false;
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action, action); queue = next.catch(() => undefined); return next;
}
export async function registerPushDevice(userId: string, token: string, platform: string) {
  return serialize(async () => {
    const session = (await supabase.auth.getSession()).data.session;
    if (signingOut || session?.user.id !== userId) return;
    const { error } = await supabase.rpc("register_push_device", {
      p_installation_id: await pushInstallationId(), p_token: token, p_platform: platform,
    });
    if (error) throw error;
  });
}
export async function pushInstallationId() {
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) { id = Crypto.randomUUID(); await SecureStore.setItemAsync(KEY, id); }
  return id;
}
async function unregister() {
  if (Platform.OS === "web") return;
  const id = await SecureStore.getItemAsync(KEY);
  if (!id) return;
  const { error } = await supabase.rpc("unregister_push_device", { p_installation_id: id });
  if (error) throw new Error("Could not disable notifications for this device. Check your connection and try again.");
}
export async function unregisterPushDevice() { return serialize(unregister); }
/** Disable this installation before revoking the session that authorizes cleanup. */
export async function signOutWithPushCleanup() {
  signingOut = true;
  try { await unregisterPushDevice(); return await supabase.auth.signOut(); }
  finally { signingOut = false; }
}
