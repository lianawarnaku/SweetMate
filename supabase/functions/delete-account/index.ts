import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { DeletionError, executeAccountDeletion } from "../_shared/account-deletion.ts";
import { json, readSmallJson } from "../_shared/http.ts";

Deno.serve(async request => {
  if(request.method === "OPTIONS") return new Response(null,{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"}});
  if(request.method !== "POST") return json({error:"Not found."},404);
  const bearer=request.headers.get("Authorization")?.replace(/^Bearer /,"");
  if(!bearer) return json({error:"Sign in again before deleting your account."},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const {data,error}=await admin.auth.getUser(bearer);
  if(error || !data.user) return json({error:"Sign in again before deleting your account."},401);
  try {
    let body; try {body=await readSmallJson(request);} catch {return json({error:"Invalid request."},400);}
    const result=await executeAccountDeletion(data.user,body,{
      config:{appleClientId:Deno.env.get("APPLE_OAUTH_CLIENT_ID"),appleClientSecret:Deno.env.get("APPLE_OAUTH_CLIENT_SECRET")},
      preflight:async id=>{const {error}=await admin.rpc("prepare_account_deletion",{target_user_id:id});if(error)throw new DeletionError("DELETION_UNAVAILABLE",503,"Could not prepare account deletion. Please try again.");},
      disconnectGoogle:async id=>{
        const {data,error}=await admin.from("google_calendar_connections").select("refresh_token").eq("user_id",id).maybeSingle();
        if(error)throw new DeletionError("DELETION_UNAVAILABLE",503,"Could not check connected services.");
        if(data?.refresh_token){
          const response=await fetch("https://oauth2.googleapis.com/revoke",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token:data.refresh_token}),signal:AbortSignal.timeout(15000)});
          // Google invalid_token means there is no remaining grant to revoke.
          const result=await response.json().catch(()=>null);
          if(!response.ok && !(response.status===400 && result?.error==='invalid_token'))throw new DeletionError("GOOGLE_UNAVAILABLE",503,"Could not disconnect Google. Please try again.");
        }
      },
      finalize:async(id,analyticsId)=>{const {error}=await admin.rpc("finalize_account_deletion",{target_user_id:id,analytics_id:analyticsId});if(error)throw new DeletionError("DELETION_UNAVAILABLE",503,"Could not confirm account deletion. Please sign in to check or contact support.");},
    });
    return json(result);
  } catch(error){
    if(error instanceof DeletionError)return json({code:error.code,error:error.message},error.status);
    // Do not log bearer/provider tokens, bodies, or raw provider/database errors.
    console.error("account_deletion_failed");
    return json({code:"DELETION_UNAVAILABLE",error:"Account deletion did not finish. Please try again."},503);
  }
});
