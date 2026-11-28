import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "./passwordPolicy.ts";
const exports: any = {};
runInNewContext(
  ts.transpileModule(readFileSync("lib/passwordRecovery.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: false,
    },
  }).outputText,
  {
    exports,
    URL,
    URLSearchParams,
    Date,
    Error,
    Set,
    Math,
    require: (name: string) => {
      if (name === "./passwordPolicy") return policy;
      assert.equal(name, "@/lib/supabase");
      return { supabase: { auth: {} } };
    },
  },
);
const {
  PasswordRecoveryController,
  createPasswordServices,
  passwordValidation,
  recoveryLink,
} = exports;
const password = "Synthetic-passphrase-123",
  redirect = "sweetmate://auth/reset-password";
function fixture(initial: string | null = null) {
  let now = 1_800_000_000_000,
    id = initial,
    used = false,
    nextId: string | null = null;
  let updateError: any = null,
    signOutError: any = null,
    verifyError: any = null,
    gate: Promise<void> | null = null;
  const calls: any[] = [];
  const session = () =>
    id ? { user: { id }, expires_at: now / 1000 + 3600 } : null;
  const verified = async (method: string) => {
    calls.push(method);
    if (gate) await gate;
    if (verifyError || (used && method === "otp"))
      return {
        data: { session: null },
        error: verifyError ?? { code: "otp_expired" },
      };
    used = true;
    id = "recovered";
    return { data: { session: session() }, error: null };
  };
  const auth = {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => {
      const user = id ? { id, email: "fixture@example.test" } : null;
      if (nextId) {
        id = nextId;
        nextId = null;
      }
      return {
        data: { user },
        error: user ? null : { code: "session_not_found" },
      };
    },
    resetPasswordForEmail: async (email: string, options: any) => {
      calls.push(["email", email, options]);
      return { error: null };
    },
    signInWithPassword: async (payload: any) => ({
      data: { user: id ? { id } : null },
      error:
        payload.password === "wrong-current"
          ? { code: "invalid_credentials" }
          : null,
    }),
    updateUser: async (payload: any) => {
      calls.push(["update", payload]);
      return { data: { user: id ? { id } : null }, error: updateError };
    },
    reauthenticate: async () => {
      calls.push("reauthenticate");
      return { error: null };
    },
    verifyOtp: (payload: any) => {
      calls.push(["otp-payload", payload]);
      return verified("otp");
    },
    setSession: () => verified("implicit"),
    exchangeCodeForSession: () => verified("code"),
    signOut: async (options: any) => {
      calls.push(["signout", options]);
      if (!signOutError) id = null;
      return { error: signOutError };
    },
  };
  const controller = new PasswordRecoveryController(
    auth,
    () => auth.signOut({ scope: "global" }),
    () => now,
  );
  return {
    controller,
    auth,
    calls,
    get id() {
      return id;
    },
    advance: (ms: number) => {
      now += ms;
    },
    setId: (value: string | null) => {
      id = value;
    },
    failUpdate: (e: any) => {
      updateError = e;
    },
    failSignOut: (e: any) => {
      signOutError = e;
    },
    failVerify: (e: any) => {
      verifyError = e;
    },
    switchDuringVerify: (value: string) => {
      nextId = value;
    },
    gate: (promise: Promise<void>) => {
      gate = promise;
    },
  };
}
const link = (query: string) => new URL(redirect + query);
const updates = (f: any) =>
  f.calls.filter((c: any) => Array.isArray(c) && c[0] === "update");
assert.match(passwordValidation("short", "short"), /12/);
assert.match(passwordValidation(password, "different"), /match/);
assert.equal(passwordValidation(password, password), null);
assert.equal(
  recoveryLink(
    "https://attacker.invalid/auth/reset-password?token_hash=x&type=recovery",
    redirect,
  ),
  null,
);
assert.equal(
  recoveryLink("sweetmate://auth/callback?type=recovery", redirect),
  null,
);
assert.equal(
  recoveryLink(redirect + "#type=recovery", redirect)?.pathname,
  "/reset-password",
);
{
  const f = fixture(),
    service = createPasswordServices(f.auth);
  await assert.rejects(service.request("invalid", redirect), /valid email/);
  assert.equal(f.calls.length, 0);
  await service.request(" test@example.test ", redirect);
  assert.equal(f.calls[0][1], "test@example.test");
  assert.equal(f.calls[0][2].redirectTo, redirect);
}
for (const query of [
  "?token_hash=synthetic&type=recovery",
  "?code=synthetic",
  "#access_token=synthetic&refresh_token=synthetic&type=recovery",
]) {
  const f = fixture();
  await f.controller.handle(link(query));
  assert.equal(f.controller.getSnapshot().phase, "ready");
  const before = f.calls.length;
  await f.controller.handle(link(query));
  assert.equal(
    f.calls.length,
    before,
    "duplicate URL delivery must not restart recovery",
  );
  await f.controller.complete(password, password);
  assert.equal(f.controller.getSnapshot().phase, "success");
  assert.equal(f.id, null);
  assert.equal(updates(f).length, 1);
  await f.controller.close();
  assert.equal(f.controller.getSnapshot().phase, "idle");
}
{
  const f = fixture("original");
  await f.controller.handle(
    link("#error=access_denied&error_code=otp_expired"),
  );
  assert.equal(
    f.controller.getSnapshot().phase,
    "expired",
    "an already-invalid link must not ask the current account to sign out",
  );
  await f.controller.close();
  assert.equal(f.id, "original");
  assert.equal(f.calls.length, 0);
}
for (const query of [
  "",
  "?token_hash=x&type=signup",
  "?token_hash=x&code=y&type=recovery",
  "#access_token=x&type=recovery",
  "#access_token=x&refresh_token=y&type=signup",
  "#error=access_denied&error_code=otp_expired",
  "#access_token=x&refresh_token=y&type=recovery&expires_at=1",
]) {
  const f = fixture();
  await f.controller.handle(link(query));
  assert.equal(f.controller.getSnapshot().phase, "expired");
  assert.equal(
    f.calls.some((c) => ["otp", "implicit", "code"].includes(c)),
    false,
  );
}
{
  const f = fixture("original");
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  assert.equal(f.controller.getSnapshot().phase, "confirm-signout");
  assert.equal(f.calls.length, 0);
  await f.controller.close();
  assert.equal(f.id, "original", "cancel preserves the original session");
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  await f.controller.continueAfterSignOut();
  assert.equal(f.id, "recovered");
  assert.equal(f.controller.getSnapshot().phase, "ready");
}
{
  const f = fixture("original");
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  f.setId("other");
  await f.controller.continueAfterSignOut();
  assert.equal(f.controller.getSnapshot().phase, "expired");
  assert.equal(f.id, "other");
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture();
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  await assert.rejects(f.controller.complete("short", "short"), /12/);
  await assert.rejects(f.controller.complete(password, "different"), /match/);
  assert.equal(updates(f).length, 0);
  f.failUpdate({ code: "weak_password", message: "sensitive response" });
  await assert.rejects(f.controller.complete(password, password), /stronger/);
  assert.equal(f.controller.getSnapshot().phase, "ready");
  f.failUpdate(null);
  f.failSignOut({ code: "network" });
  await assert.rejects(f.controller.complete(password, password), /connection/);
  assert.equal(f.controller.getSnapshot().phase, "signout-required");
  const count = updates(f).length;
  f.failSignOut(null);
  await f.controller.finishSignOut();
  assert.equal(f.controller.getSnapshot().phase, "success");
  assert.equal(updates(f).length, count);
}
{
  const f = fixture();
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  f.advance(exports.RECOVERY_FORM_LIFETIME_MS + 1);
  f.controller.expire();
  assert.equal(f.controller.getSnapshot().phase, "expired");
  await assert.rejects(
    f.controller.complete(password, password),
    /new reset email/,
  );
  await f.controller.close();
  assert.equal(
    f.id,
    null,
    "an expired recovery cannot unlock normal household navigation",
  );
}
{
  const f = fixture();
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  f.setId("other");
  f.controller.observe("SIGNED_IN", { user: { id: "other" } });
  await assert.rejects(
    f.controller.complete(password, password),
    /new reset email/,
  );
  await f.controller.close();
  assert.equal(f.id, "other");
}
{
  const f = fixture();
  f.failVerify({ code: "otp_expired", message: "do not display secrets" });
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  assert.match(f.controller.getSnapshot().message, /expired/);
  assert(!JSON.stringify(f.controller.getSnapshot()).includes("secrets"));
}
{
  const f = fixture();
  let release!: () => void;
  f.gate(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const first = f.controller.handle(link("?token_hash=x&type=recovery"));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  release();
  await first;
  assert.equal(f.calls.filter((c) => c === "otp").length, 1);
}
{
  const f = fixture("signed-in"),
    service = createPasswordServices(f.auth);
  f.failUpdate({ code: "invalid_credentials" });
  await assert.rejects(
    service.change("signed-in", password, password, "wrong-current"),
    /current password/,
  );
  f.failUpdate(null);
  await service.change(
    "signed-in",
    password,
    password,
    "verified-current",
    "123456",
  );
  assert.equal(updates(f).at(-1)[1].current_password, "verified-current");
  assert.equal(updates(f).at(-1)[1].nonce, "123456");
  await service.reauthenticate("signed-in");
  assert(f.calls.includes("reauthenticate"));
  f.switchDuringVerify("other");
  const before = updates(f).length;
  await assert.rejects(
    service.change("signed-in", password, password, "verified-current"),
    /account changed/,
  );
  assert.equal(updates(f).length, before);
}
for (const code of ["session_not_found", "current_password_required"]) {
  const f = fixture();
  await f.controller.handle(link("?token_hash=x&type=recovery"));
  f.failUpdate({ code });
  await assert.rejects(
    f.controller.complete(password, password),
    /expired|recovery session ended/,
  );
  assert.equal(
    f.controller.getSnapshot().phase,
    "expired",
    "a recovery session rejected at save must offer a new email instead of a stuck password form",
  );
  await f.controller.close();
  assert.equal(f.id, null);
}
assert(!readFileSync("app/settings.tsx", "utf8").includes("resetDemoCode"));
assert(!readFileSync("app/settings.tsx", "utf8").includes("@/lib/auth"));
console.log(
  "Password recovery: expired/used/malformed links, duplicate delivery, account isolation, actual API payloads, validation, reauthentication and sign-out retry passed.",
);
