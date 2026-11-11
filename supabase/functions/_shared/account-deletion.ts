export class DeletionError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
type Identity = { provider: string; id?: string; identity_data?: { sub?: string } };
type User = { id: string; identities?: Identity[] };
type Config = { appleClientId?: string; appleClientSecret?: string };

/** Tokens are accepted only for the authenticated account and never logged. */
export async function revokeAppleForDeletion(user: User, token: unknown, config: Config, request: typeof fetch = fetch) {
  const apple = user.identities?.filter(i => i.provider === "apple") ?? [];
  if (!apple.length) return;
  if (!config.appleClientId || !config.appleClientSecret) throw new DeletionError("APPLE_NOT_CONFIGURED", 503, "Account deletion is temporarily unavailable. Please contact support.");
  if (typeof token !== "string" || !token || token.length > 8192) throw new DeletionError("APPLE_REAUTH_REQUIRED", 409, "Sign in with your linked Apple account again to confirm deletion.");
  const form = (extra: Record<string, string>) => new URLSearchParams({client_id: config.appleClientId!, client_secret: config.appleClientSecret!, ...extra});
  let response: Response;
  try {
    response = await request("https://appleid.apple.com/auth/token", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:form({grant_type:"refresh_token", refresh_token:token}), signal:AbortSignal.timeout(15000)});
  } catch { throw new DeletionError("APPLE_UNAVAILABLE", 503, "Apple could not confirm deletion. Please try again."); }
  if (!response.ok) throw new DeletionError("APPLE_REAUTH_REQUIRED", 409, "Apple could not confirm your account. Sign in again and retry.");
  const result = await response.json().catch(() => null);
  // Decode ONLY the identity token received directly from Apple's authenticated
  // HTTPS token endpoint, never a client-supplied identity token.
  let claims: {sub?: string; aud?: string; iss?: string} = {};
  try { const part=result.id_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"); claims=JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,"="))); } catch { /* rejected below */ }
  if (claims.iss !== "https://appleid.apple.com" || claims.aud !== config.appleClientId || !apple.some(i => (i.identity_data?.sub ?? i.id) === claims.sub)) throw new DeletionError("APPLE_ACCOUNT_MISMATCH", 403, "Choose the Apple account linked to this SweetMate account.");
  try {
    response = await request("https://appleid.apple.com/auth/revoke", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:form({token,token_type_hint:"refresh_token"}),signal:AbortSignal.timeout(15000)});
  } catch { throw new DeletionError("APPLE_UNAVAILABLE", 503, "Apple revocation did not finish. Please try again."); }
  if (!response.ok) throw new DeletionError("APPLE_UNAVAILABLE", 503, "Apple revocation did not finish. Please try again.");
}

export async function executeAccountDeletion(user: User, body: unknown, dependencies: {
  config: Config; request?: typeof fetch;
  preflight: (id: string) => Promise<void>;
  disconnectGoogle: (id: string) => Promise<void>;
  finalize: (id: string, analyticsId: string | null) => Promise<void>;
}) {
  const input=body as {appleRefreshToken?:unknown;analyticsId?:unknown} | null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DeletionError("INVALID_REQUEST",400,"Invalid deletion request.");
  if (Object.keys(input).some(k=>!['appleRefreshToken','analyticsId'].includes(k))) throw new DeletionError("INVALID_REQUEST",400,"Invalid deletion request.");
  const analyticsId=input.analyticsId == null ? null : input.analyticsId;
  if (analyticsId !== null && (typeof analyticsId !== "string" || !/^sm_[a-zA-Z0-9_-]{8,128}$/.test(analyticsId))) throw new DeletionError("INVALID_REQUEST",400,"Invalid deletion request.");
  await dependencies.preflight(user.id);
  await revokeAppleForDeletion(user,input.appleRefreshToken,dependencies.config,dependencies.request);
  await dependencies.disconnectGoogle(user.id);
  await dependencies.finalize(user.id,analyticsId as string | null);
  return {deleted:true};
}
