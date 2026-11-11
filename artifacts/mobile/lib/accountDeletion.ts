import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { authCallbackValue } from "./oauthCallback";

/** Uses the existing singleton and never sends Apple credentials to analytics. */
export async function deleteAuthenticatedAccount(): Promise<void> {
  const original=(await supabase.auth.getSession()).data.session;
  if(!original)throw new Error("Sign in again before deleting your account.");
  const {data,error}=await supabase.auth.getUser(original.access_token);
  if(error || !data.user || data.user.id!==original.user.id)throw new Error("Sign in again before deleting your account.");
  let appleRefreshToken: string | undefined;
  if(data.user.identities?.some(i=>i.provider==='apple')){
    const redirectTo=ExpoLinking.createURL('auth/callback');
    const {data:oauth,error}=await supabase.auth.signInWithOAuth({provider:'apple',options:{redirectTo,skipBrowserRedirect:true}});
    if(error || !oauth.url)throw new Error("Could not start Apple confirmation. Please try again.");
    const result=await WebBrowser.openAuthSessionAsync(oauth.url,redirectTo);
    if(result.type!=='success')throw new Error("Account deletion was cancelled. Your account has not been deleted.");
    if(authCallbackValue(result.url,'error'))throw new Error("Apple confirmation was not completed. Your account has not been deleted.");
    const code=authCallbackValue(result.url,'code');
    const accessToken=authCallbackValue(result.url,'access_token');
    const refreshToken=authCallbackValue(result.url,'refresh_token');
    if(!code && (!accessToken || !refreshToken))throw new Error("Apple returned an incomplete confirmation. Please retry.");
    const exchange=code ? await supabase.auth.exchangeCodeForSession(code) : await supabase.auth.setSession({access_token:accessToken!,refresh_token:refreshToken!});
    if(exchange.error || exchange.data.session?.user.id!==original.user.id){
      await supabase.auth.setSession({access_token:original.access_token,refresh_token:original.refresh_token});
      throw new Error("Choose the Apple account linked to this SweetMate account.");
    }
    appleRefreshToken=exchange.data.session.provider_refresh_token ?? authCallbackValue(result.url,'provider_refresh_token') ?? undefined;
    if(!appleRefreshToken)throw new Error("Apple did not return the credential needed to revoke access. Please retry or contact support.");
  }
  const session=(await supabase.auth.getSession()).data.session;
  if(!session || session.user.id!==original.user.id)throw new Error("Your account changed. Please retry deletion.");
  const analyticsId=await AsyncStorage.getItem(`sweetmate:analytics-id:v1:${original.user.id}`);
  const projectUrl=process.env.EXPO_PUBLIC_SUPABASE_URL;
  if(!projectUrl)throw new Error("Account deletion is unavailable in this build.");
  const response=await fetch(`${projectUrl}/functions/v1/delete-account`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({appleRefreshToken,analyticsId}),
  });
  const result=await response.json().catch(()=>null) as {deleted?:boolean;error?:string}|null;
  if(!response.ok || result?.deleted!==true)throw new Error(result?.error ?? "Account deletion did not finish. Please retry.");
}

export async function clearDeletedAccountStorage(userId:string){
  const keys=await AsyncStorage.getAllKeys();
  // Preserve other signed-in people's device data and all unrelated app keys.
  await AsyncStorage.multiRemove(keys.filter(key=>key.startsWith(`sweetmate:user:${userId}:`) ||
    key===`sweetmate:user-preferences:v1:${userId}` || key===`sweetmate:analytics-id:v1:${userId}` ||
    key===`sweetmate:telemetry-preferences:v1:${userId}` || key===`sweetmate:analytics-first:v1:${userId}` ||
    key.startsWith(`@sweetmate/external-task/v1/${encodeURIComponent(userId)}/`) || key===`@sweetmate/external-task-destination/v1/${encodeURIComponent(userId)}` || key==='homebase_data_v7'));
}
