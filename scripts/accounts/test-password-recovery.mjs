// Actual local Auth + Mailpit + database; never accepts a production endpoint.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  require = createRequire(root + "/artifacts/mobile/package.json");
const cli =
  root +
  "/node_modules/.pnpm/@supabase+cli-darwin-arm64@2.109.1/node_modules/@supabase/cli-darwin-arm64/bin/supabase";
const raw = execFileSync(
  cli,
  [
    "status",
    "--workdir",
    "/Users/lianawarnakulasooriya/Downloads/SweetMate-codex-qa-browser-preview/.sweetmate-qa/backend",
    "--output",
    "json",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const config = JSON.parse(
  raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
);
assert.equal(config.API_URL, "http://127.0.0.1:54321");
const mailUrl =
  config.INBUCKET_URL || config.MAILPIT_URL || "http://127.0.0.1:54324";
assert(["localhost", "127.0.0.1"].includes(new URL(mailUrl).hostname));
const { createClient } = require("@supabase/supabase-js"),
  ts = require("typescript");
const clients = [];
const client = () => {
  const c = createClient(config.API_URL, config.ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  clients.push(c);
  return c;
};
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const code = ts.transpileModule(
  readFileSync(root + "/artifacts/mobile/lib/passwordRecovery.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
runInNewContext(code, {
  exports,
  URL,
  URLSearchParams,
  Date,
  Error,
  Set,
  Math,
  require: () => ({ supabase: { auth: client().auth } }),
});
const { createPasswordServices, PasswordRecoveryController } = exports;
const users = [];
let stage = "initialization";
async function ok(value, label) {
  if (value.error)
    throw Error(label + ": " + (value.error.code || "request failed"));
  return value.data;
}
async function signIn(c, email, password) {
  return ok(
    await c.auth.signInWithPassword({ email, password }),
    "dummy sign-in",
  );
}
const callback = "http://127.0.0.1:4173/auth/reset-password";
async function mailFor(email) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(mailUrl + "/api/v1/messages", {
      signal: AbortSignal.timeout(5000),
    });
    assert(res.ok);
    const body = await res.json();
    const match = (body.messages || []).find((m) =>
      (m.To || []).some((to) => to.Address === email),
    );
    if (match) {
      const detail = await fetch(mailUrl + "/api/v1/message/" + match.ID).then(
        (r) => r.json(),
      );
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error("Disposable recovery email did not arrive in local Mailpit");
}
try {
  stage = "create isolated dummy accounts";
  for (let i = 0; i < 2; i++) {
    const email = "password-recovery-" + randomUUID() + "@sweetmate.local",
      password = randomBytes(24).toString("base64url");
    const data = await ok(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      "create dummy",
    );
    users.push({ id: data.user.id, email, password });
  }
  const [a, b] = users,
    aClient = client(),
    bClient = client();
  await signIn(aClient, a.email, a.password);
  await signIn(bClient, b.email, b.password);
  const homeData = await ok(
    await aClient.rpc("create_household", {
      household_name: "Disposable password recovery home",
      member_name: "Recovery A",
      member_color: "#888888",
      requested_invite_code: randomBytes(4).toString("hex").toUpperCase(),
      household_timezone: "America/New_York",
    }),
    "create dummy home",
  );
  const home = homeData[0].household_id;
  const homeRow = { invite_code: homeData[0].invite_code };
  await ok(
    await bClient.rpc("join_household", {
      code: homeRow.invite_code,
      member_name: "Recovery B",
      member_color: "#999999",
    }),
    "join dummy home",
  );
  const listId = "recovery-list-" + randomUUID();
  await ok(
    await aClient
      .from("shopping_lists")
      .insert({
        id: listId,
        household_id: home,
        name: "Preserve password test list",
        entry: { id: listId, name: "Preserve password test list" },
        sort_order: 0,
      }),
    "dummy list",
  );
  const originalRefresh = (await aClient.auth.getSession()).data.session
    .refresh_token;
  stage = "wrong-current-password protection";
  const services = createPasswordServices(aClient.auth),
    changedPassword = randomBytes(24).toString("base64url");
  await assert.rejects(
    services.change(
      a.id,
      changedPassword,
      changedPassword,
      "intentionally-wrong-password",
    ),
  );
  await signIn(client(), a.email, a.password);
  console.log(
    "PASS real current-password rejection leaves the old password working",
  );
  stage = "secure authenticated password update";
  await services.change(a.id, changedPassword, changedPassword, a.password);
  await ok(await aClient.auth.signOut({ scope: "global" }), "dummy sign-out");
  assert(
    (
      await client().auth.signInWithPassword({
        email: a.email,
        password: a.password,
      })
    ).error,
  );
  await signIn(client(), a.email, changedPassword);
  const oldRefresh = await client().auth.refreshSession({
    refresh_token: originalRefresh,
  });
  assert(oldRefresh.error);
  console.log(
    "PASS authenticated cloud password change, old-password rejection and refresh-session revocation",
  );
  stage = "real recovery email delivery";
  const recoveredClient = client();
  await createPasswordServices(recoveredClient.auth).request(a.email, callback);
  const mail = await mailFor(a.email);
  const link = (mail.HTML || mail.Text || "")
    .match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/i)?.[0]
    ?.replaceAll("&amp;", "&");
  assert(link, "Local Auth email must contain its real verification link");
  const verified = await fetch(link, {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  assert([302, 303].includes(verified.status));
  const location = verified.headers.get("location");
  assert(
    location.startsWith(callback),
    "Recovery redirect allowlist must preserve the exact app callback path",
  );
  const recovery = new PasswordRecoveryController(recoveredClient.auth, () =>
    recoveredClient.auth.signOut({ scope: "global" }),
  );
  await recovery.handle(new URL(location));
  assert.equal(recovery.getSnapshot().phase, "ready");
  const recoveredPassword = randomBytes(24).toString("base64url");
  await recovery.complete(recoveredPassword, recoveredPassword);
  assert.equal(recovery.getSnapshot().phase, "success");
  assert(
    (
      await client().auth.signInWithPassword({
        email: a.email,
        password: changedPassword,
      })
    ).error,
  );
  const recoveredSession = await signIn(client(), a.email, recoveredPassword);
  assert.equal(recoveredSession.user.id, a.id);
  console.log(
    "PASS actual local SMTP email, verification redirect, recovery session and new-password login",
  );
  stage = "reused-link handling";
  const replay = await fetch(link, {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const expired = new PasswordRecoveryController(client().auth, async () => ({
    error: null,
  }));
  await expired.handle(new URL(replay.headers.get("location")));
  assert.equal(expired.getSnapshot().phase, "expired");
  console.log(
    "PASS reused email link rejected by real Auth and shown as unavailable",
  );
  stage = "token-hash recovery";
  const generated = await ok(
    await admin.auth.admin.generateLink({
      type: "recovery",
      email: a.email,
      options: { redirectTo: callback },
    }),
    "generate disposable recovery",
  );
  const hashClient = client(),
    hashController = new PasswordRecoveryController(hashClient.auth, () =>
      hashClient.auth.signOut({ scope: "local" }),
    );
  await hashController.handle(
    new URL(
      callback +
        "?type=recovery&token_hash=" +
        encodeURIComponent(generated.properties.hashed_token),
    ),
  );
  assert.equal(hashController.getSnapshot().phase, "ready");
  await hashController.close();
  assert(
    (
      await client().auth.verifyOtp({
        type: "recovery",
        token_hash: generated.properties.hashed_token,
      })
    ).error,
  );
  console.log("PASS real token-hash recovery and single-use verification");
  stage = "expired server token";
  const outdated = await ok(
    await admin.auth.admin.generateLink({
      type: "recovery",
      email: a.email,
      options: { redirectTo: callback },
    }),
    "generate expiry fixture",
  );
  assert(/^[0-9a-f-]{36}$/.test(a.id));
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_sweetmate-qa",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `update auth.users set recovery_sent_at=now()-interval '2 hours' where id='${a.id}' and email like 'password-recovery-%@sweetmate.local'`,
    ],
    { stdio: "pipe" },
  );
  const expiredHash = new PasswordRecoveryController(
    client().auth,
    async () => ({ error: null }),
  );
  await expiredHash.handle(
    new URL(
      callback +
        "?type=recovery&token_hash=" +
        encodeURIComponent(outdated.properties.hashed_token),
    ),
  );
  assert.equal(expiredHash.getSnapshot().phase, "expired");
  console.log(
    "PASS actual expired recovery token is denied without changing the password",
  );
  stage = "saved household preservation";
  const member = await ok(
    await bClient
      .from("household_members")
      .select("user_id,status")
      .eq("household_id", home),
    "check memberships",
  );
  assert.equal(member.filter((m) => m.status === "active").length, 2);
  const saved = await ok(
    await bClient
      .from("shopping_lists")
      .select("id,name")
      .eq("id", listId)
      .single(),
    "check saved list",
  );
  assert.equal(saved.name, "Preserve password test list");
  await signIn(client(), a.email, recoveredPassword);
  console.log(
    "PASS same account ID, two active roommates and saved household records preserved",
  );
} catch (error) {
  console.error(
    "FAIL password recovery stage:",
    stage,
    "—",
    error instanceof assert.AssertionError
      ? error.message
      : String(error.message || "request failed"),
  );
  process.exitCode = 1;
} finally {
  for (const user of users) {
    assert(
      user.email.startsWith("password-recovery-") &&
        user.email.endsWith("@sweetmate.local"),
    );
    const result = await admin.rpc("finalize_account_deletion", {
      target_user_id: user.id,
      analytics_id: null,
    });
    if (result.error) {
      console.error("FAIL disposable recovery fixture cleanup");
      process.exitCode = 1;
    }
  }
  for (const c of clients) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
}
