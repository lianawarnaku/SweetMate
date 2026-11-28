// Local Auth/PostgREST/RLS admission audit. Never sends invitations or messages.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  req = createRequire(root + "/artifacts/mobile/package.json");
const { createClient } = req("@supabase/supabase-js");
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
const c = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
if (c.API_URL !== "http://127.0.0.1:54321") throw Error("Local QA only");
const admin = createClient(c.API_URL, c.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  users = [],
  tag = "invitation-audit-" + randomUUID();
const good = (r, label) => {
  if (r.error) throw Error(label + ": " + r.error.code + " " + r.error.message);
  return r.data;
};
const sql = (q) =>
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
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      q,
    ],
    { encoding: "utf8" },
  ).trim();
const digest = (code) =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
let passed = 0;
const pass = (label) => {
  passed++;
  console.log("PASS " + label);
};
const reset = (user) =>
  sql(
    `delete from public.household_invitation_limits where user_id='${user.id}'`,
  );
const join = async (user, code) =>
  good(
    await user.client.rpc("redeem_household_invite", {
      invitation_hash: digest(code),
      member_name: "Disposable member",
      member_color: "#888888",
    }),
    "redeem",
  );
const rpc = async (user, name, body) =>
  good(await user.client.rpc(name, body), name);
const post = async (user, name, body, headers = {}) => {
  const response = await fetch(c.API_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: c.ANON_KEY,
      Authorization: "Bearer " + user.token,
      "Content-Type": "application/json",
      "x-sweetmate-chore-policy": "single-obligation-v1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
};
try {
  for (const name of ["Host", "Member", "Other", "Unverified"]) {
    const email = tag + "-" + name.toLowerCase() + "@sweetmate.local",
      password = randomBytes(24).toString("base64url");
    const made = good(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: name !== "Unverified",
      }),
      "create fixture",
    );
    const user = { id: made.user.id, email };
    users.push(user);
    if (name !== "Unverified") {
      user.client = createClient(c.API_URL, c.ANON_KEY, {
        global: {
          headers: { "x-sweetmate-chore-policy": "single-obligation-v1" },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = good(
        await user.client.auth.signInWithPassword({ email, password }),
        "fixture login",
      );
      user.token = signed.session.access_token;
    }
  }
  const [a, b, d, u] = users;
  const homeRow = (
    await rpc(a, "create_household", {
      household_name: tag,
      member_name: "Disposable host",
      member_color: "#777777",
      requested_invite_code: "",
      household_timezone: "America/New_York",
    })
  )[0];
  const legacyCode = randomBytes(4).toString("hex").toUpperCase();
  const legacyHome = (await rpc(a, "create_household", { household_name: tag + " legacy", member_name: "Old app host", member_color: "#777777", requested_invite_code: legacyCode }))[0];
  assert.equal(legacyHome.invite_code, legacyCode, "build 54 displays its proposed code immediately");
  assert.equal((await join(d, legacyCode)).ok, true, "old-client displayed code must join the saved household");
  sql(`delete from public.households where id='${legacyHome.household_id}'`);
  const home = homeRow.household_id;
  let code = homeRow.invite_code;
  assert.match(code, /^[A-F0-9]{12}$/);
  assert.notEqual(code, "AABBCCDD");
  const joinOperation=randomUUID(),joinPacket={name:"redeem_household_invite",rpc:true,method:"POST",body:{invitation_hash:digest(code),member_name:"Disposable member",member_color:"#888888"},query:[],prefer:"",accept:""};
  const joinedReceipt=await post(b,"execute_app_operation",{operation_id:joinOperation,operation_request:joinPacket});assert.equal(joinedReceipt.data.data.ok,true);
  assert.equal((await join(b, code)).ok, true);
  assert.equal((await join(a, code)).ok, true);
  assert.equal(
    sql(
      `select role from public.household_members where household_id='${home}' and user_id='${a.id}'`,
    ),
    "owner",
  );
  pass(
    "server-generated codes, ordinary admission, active-member idempotence and owner role preservation",
  );
  const marker = tag + "-saved";
  sql(
    `insert into public.chores(id,household_id,title,creator_id,assigned_to,due_date,points) values('${marker}','${home}','Saved fixture','${a.id}','${b.id}','2026-12-01',2)`,
  );
  const status = () =>
    sql(
      `select status from public.household_members where household_id='${home}' and user_id='${b.id}'`,
    );
  const currentCode = () =>
    sql(`select invite_code from public.households where id='${home}'`);
  const remove = async () => {
    await rpc(a, "remove_household_member", {
      target_household_id: home,
      target_user_id: b.id,
    });
    code = currentCode();
  };
  const issue = async (personal = true) => {
    const token = randomBytes(16).toString("hex").toUpperCase();
    const result = await rpc(a, "create_household_reinvitation", {
      target_household_id: home,
      target_user_id: b.id,
      token_hash: personal ? digest(token) : null,
      token_suffix: personal ? token.slice(-4) : null,
    });
    assert.equal(result.ok, true);
    return { ...result, token };
  };
  sql(
    `update public.household_members set role='owner' where household_id='${home}' and user_id='${b.id}'`,
  );
  const old = code;
  await remove();
  assert.notEqual(code, old);
  assert.equal(status(), "removed");
  const staleJoin=await post(b,"execute_app_operation",{operation_id:joinOperation,operation_request:joinPacket});assert.equal(staleJoin.data.status,403);assert.equal(status(),"removed");
  assert.equal((await b.client.rpc("create_household_reinvitation",{target_household_id:home,target_user_id:b.id})).error.code,"42501");

  assert.equal((await join(b, old)).ok, false);
  assert.equal((await join(d, old)).ok, false);
  assert.equal((await join(b, code)).ok, false);
  const frozenName = sql(
    `select display_name from public.household_members where household_id='${home}' and user_id='${b.id}'`,
  );
  await b.client
    .from("household_members")
    .update({ display_name: "Spoofed host" })
    .eq("household_id", home)
    .eq("user_id", b.id);
  assert.equal(
    sql(
      `select display_name from public.household_members where household_id='${home}' and user_id='${b.id}'`,
    ),
    frozenName,
  );
  assert.equal(
    (await b.client.from("chores").select("id").eq("household_id", home)).data
      .length,
    0,
  );
  assert.equal(sql(`select count(*) from auth.users where id='${b.id}'`), "1");
  pass(
    "removal revokes old shared codes, blocks the current shared code for the removed account, and immediately denies household data",
  );
  const denied = await d.client.rpc("create_household_reinvitation", {
    target_household_id: home,
    target_user_id: b.id,
  });
  assert.equal(denied.error.code, "42501");
  const approval = await issue(false);
  assert.equal(status(), "removed");
  assert.equal((await join(b, code)).ok, true);
  assert.equal(status(), "active");
  assert.equal(
    sql(
      `select role from public.household_members where household_id='${home}' and user_id='${b.id}'`,
    ),
    "member",
  );
  assert.notEqual(
    sql(
      `select used_at is not null from public.household_reinvitations where id='${approval.id}'`,
    ),
    "f",
  );
  pass(
    "only the active host can approve rejoining; approval is consumed by the member, without automatically adding them",
  );
  await remove();
  assert.equal((await join(b, code)).ok, false);
  reset(b);
  let personal = await issue();
  assert.equal((await join(d, personal.token)).ok, false);
  assert.equal((await join(b, personal.token)).ok, true);
  const joinedAt = sql(
    `select joined_at from public.household_members where household_id='${home}' and user_id='${b.id}'`,
  );
  assert.equal((await join(b, personal.token)).ok, true);
  assert.equal(
    sql(
      `select joined_at from public.household_members where household_id='${home}' and user_id='${b.id}'`,
    ),
    joinedAt,
  );
  assert((await a.client.from("household_reinvitations").select("*")).error);
  assert(
    (
      await a.client
        .from("household_invitation_limits")
        .delete()
        .eq("user_id", a.id)
    ).error,
  );
  assert(
    !JSON.stringify(
      await rpc(a, "get_household_invitations", { target_household_id: home }),
    ).includes(personal.token),
  );
  pass(
    "personal invitations are account-bound, single-use/idempotent while active, stored as hashes, and hidden from direct table access",
  );
  await remove();
  assert.equal((await join(b, personal.token)).ok, false);
  reset(b);
  personal = await issue();
  const storedVerifier=sql(`select token_hash from public.household_reinvitations where id='${personal.id}'`);
  assert.notEqual(storedVerifier,digest(personal.token));
  assert.equal((await rpc(b,"redeem_household_invite",{invitation_hash:storedVerifier,member_name:"Test",member_color:"#888888"})).ok,false);
  await rpc(a, "revoke_household_reinvitation", {
    target_household_id: home,
    invitation_id: personal.id,
  });
  assert.equal((await join(b, personal.token)).ok, false);
  personal = await issue();
  sql(
    `update public.household_reinvitations set expires_at=clock_timestamp()-interval '1 second' where id='${personal.id}'`,
  );
  assert.equal((await join(b, personal.token)).ok, false);
  pass(
    "a later removal invalidates used grants; individually revoked and expired invitations cannot be redeemed",
  );
  const grant = await issue(false);
  await rpc(a, "revoke_household_reinvitation", {
    target_household_id: home,
    invitation_id: grant.id,
  });
  assert.equal((await join(b, code)).ok, false);
  personal = await issue();
  const prior = code;
  await rpc(a, "manage_household_invites", {
    target_household_id: home,
    invite_action: "rotate",
  });
  code = currentCode();
  assert.notEqual(code, prior);
  assert.equal((await join(b, personal.token)).ok, false);
  personal = await issue();
  await rpc(a, "manage_household_invites", {
    target_household_id: home,
    invite_action: "pause",
  });
  assert.equal((await join(b, personal.token)).ok, false);
  assert.equal((await join(d, currentCode())).ok, false);
  await rpc(a, "manage_household_invites", {
    target_household_id: home,
    invite_action: "resume",
  });
  code = currentCode();
  assert.equal((await join(b, personal.token)).ok, false);
  reset(b);
  reset(a);
  pass(
    "approval revocation, shared-code rotation, pausing, and resuming revoke outstanding grants without reviving old invitations",
  );
  personal = await issue();
  const simultaneous = await Promise.all(
    Array.from({ length: 6 }, () => join(b, personal.token)),
  );
  assert(simultaneous.every((result) => result.ok));
  assert.equal(
    sql(
      `select count(*) from public.household_members where household_id='${home}' and user_id='${b.id}'`,
    ),
    "1",
  );
  await Promise.all([
    join(b, personal.token),
    rpc(a, "remove_household_member", {
      target_household_id: home,
      target_user_id: b.id,
    }),
  ]);
  code = currentCode();
  assert.equal(status(), "removed");
  assert.equal((await join(b, personal.token)).ok, false);
  reset(b);
  pass(
    "concurrent redemptions create one membership, and removal wins against an in-flight old invitation",
  );
  reset(d);
  for (let i = 0; i < 10; i++)
    assert.equal((await join(d, "FFFFFFFFFFFF")).code, "INVITE_UNAVAILABLE");
  const limited = await join(d, code);
  assert.equal(limited.code, "RATE_LIMITED");
  assert(limited.retry_after_seconds > 0);
  assert.equal(
    sql(
      `select attempts from public.household_invitation_limits where user_id='${d.id}' and action='join' and window_seconds=900`,
    ),
    "11",
  );
  const legacy = await post(d, "join_household", {
    code: "FFFFFFFFFFFF",
    member_name: "Test",
    member_color: "#888888",
  });
  assert.equal(legacy.status, 429);
  pass(
    "failed join attempts persist across HTTP requests and both legacy and current endpoints share the account rate limit",
  );
  reset(d);
  const before = Number(
    sql(
      `select coalesce(sum(attempts),0) from public.household_invitation_limits where user_id='${d.id}'`,
    ),
  );
  const forcedRollback = await post(
    d,
    "redeem_household_invite",
    {
      invitation_hash: digest("FFFFFFFFFFFF"),
      member_name: "Test",
      member_color: "#888888",
    },
    { Prefer: "tx=rollback" },
  );
  assert.equal(forcedRollback.data.ok, false);
  assert(
    Number(
      sql(
        `select sum(attempts) from public.household_invitation_limits where user_id='${d.id}'`,
      ),
    ) > before,
  );
  const operation = randomUUID(),
    packet = {
      name: "redeem_household_invite",
      rpc: true,
      method: "POST",
      body: {
        invitation_hash: digest("FFFFFFFFFFFF"),
        member_name: "Test",
        member_color: "#888888",
      },
      query: [],
      prefer: "",
      accept: "",
    };
  const batch = await post(d, "execute_app_operation", {
    operation_id: operation,
    operation_request: {
      name: "batch",
      rpc: true,
      method: "POST",
      body: [packet],
      query: [],
      prefer: "",
      accept: "",
    },
  });
  assert.equal(batch.status, 400);
  pass(
    "transaction-rollback preference cannot erase counters, and admission is rejected inside mutation batches",
  );
  reset(b);
  reset(a);
  personal = await issue();
  const receiptId = randomUUID(),
    request = {
      name: "create_household_reinvitation",
      rpc: true,
      method: "POST",
      body: {
        target_household_id: home,
        target_user_id: b.id,
        token_hash: digest(personal.token),
        token_suffix: personal.token.slice(-4),
      },
      query: [],
      prefer: "",
      accept: "",
    };
  const first = await post(a, "execute_app_operation", {
    operation_id: receiptId,
    operation_request: request,
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.data.ok, true);
  const count = sql(
    `select count(*) from public.household_reinvitations where household_id='${home}'`,
  );
  const retry = await post(a, "execute_app_operation", {
    operation_id: receiptId,
    operation_request: request,
  });
  assert.deepEqual(first, retry);
  assert.equal(
    sql(
      `select count(*) from public.household_reinvitations where household_id='${home}'`,
    ),
    count,
  );
  assert(!JSON.stringify(first).includes(personal.token));
  pass(
    "lost-acknowledgement retry reuses the grant receipt without issuing another invitation or storing its plaintext token",
  );
  reset(a);
  for (let i = 0; i < 30; i++) await issue(false);
  const over = await rpc(a, "create_household_reinvitation", {
    target_household_id: home,
    target_user_id: b.id,
  });
  assert.equal(over.ok, false);
  const state = await rpc(a, "get_household_invitations", {
    target_household_id: home,
  });
  assert(state.invitations.length);
  assert.equal(
    (
      await rpc(a, "revoke_household_reinvitation", {
        target_household_id: home,
        invitation_id: state.invitations[0].id,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await rpc(a, "manage_household_invites", {
        target_household_id: home,
        invite_action: "pause",
      })
    ).ok,
    true,
  );
  pass(
    "host issuance is throttled while individual revocation and emergency pausing stay available",
  );
  reset(d);
  for(let window=0;window<3;window++){
    sql(`delete from public.household_invitation_limits where user_id='${d.id}' and action='join' and window_seconds=900`);
    for(let attempt=0;attempt<10;attempt++)assert.equal((await join(d,"FFFFFFFFFFFF")).code,"INVITE_UNAVAILABLE");
  }
  sql(`delete from public.household_invitation_limits where user_id='${d.id}' and action='join' and window_seconds=900`);
  assert.equal((await join(d,code)).code,"RATE_LIMITED");
  await d.client.auth.refreshSession();assert.equal((await join(d,code)).code,"RATE_LIMITED");
  pass("daily join limits survive short-window resets and session refreshes");
  const check = sql(
    `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${u.id}',true); select public.redeem_household_invite('${digest(code)}','Unverified','#888888')->>'code'; rollback;`,
  );
  assert(check.includes("VERIFY_ACCOUNT"));
  assert.equal(
    sql(`select count(*) from public.chores where id='${marker}'`),
    "1",
  );
  assert(
    (
      await b.client
        .from("household_members")
        .update({ status: "active" })
        .eq("household_id", home)
        .eq("user_id", b.id)
    ).error,
  );
  pass(
    "unverified accounts and direct status changes are denied; saved household records and accounts are retained",
  );
  reset(a);
  await rpc(a, "manage_household_invites", {
    target_household_id: home,
    invite_action: "resume",
  });
  code = currentCode();
  reset(d);
  const fullHome = sql(
    `begin; do $$ declare person uuid; begin for n in 1..49 loop person:=gen_random_uuid(); insert into auth.users(id,email,email_confirmed_at) values(person,person::text||'@invitation-cap.invalid',now()); insert into public.household_members(household_id,user_id,display_name,role,status) values('${home}',person,'Cap fixture','member','active'); end loop; end $$; set local role authenticated; select set_config('request.jwt.claim.sub','${d.id}',true); select public.redeem_household_invite('${digest(code)}','Cap fixture','#888888')->>'code'; rollback;`,
  );
  assert(fullHome.includes("MEMBERSHIP_LIMIT"));
  const fullAccount = sql(
    `begin; do $$ declare extra uuid; begin for n in 1..20 loop extra:=gen_random_uuid(); insert into public.households(id,name,invite_code,created_by) values(extra,'Cap fixture',upper(substr(replace(extra::text,'-',''),1,12)),'${d.id}'); insert into public.household_members(household_id,user_id,display_name,role,status) values(extra,'${d.id}','Cap fixture','owner','active'); end loop; end $$; set local role authenticated; select set_config('request.jwt.claim.sub','${d.id}',true); select public.redeem_household_invite('${digest(code)}','Cap fixture','#888888')->>'code'; rollback;`,
  );
  assert(fullAccount.includes("MEMBERSHIP_LIMIT"));
  pass(
    "50-member and 20-household caps are enforced by the server, with transactional test fixtures rolled back",
  );
  console.log(JSON.stringify({ passed, localOnly: true, invitesSent: 0 }));
} finally {
  for (const user of users) {
    assert(user.email.startsWith(tag + "-"));
    good(
      await admin.rpc("finalize_account_deletion", {
        target_user_id: user.id,
        analytics_id: null,
      }),
      "fixture cleanup",
    );
  }
  console.log(
    "Removed only disposable invitation-audit accounts and households.",
  );
}
