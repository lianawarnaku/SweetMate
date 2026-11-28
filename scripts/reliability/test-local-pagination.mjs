// Genuine local PostgREST/RLS tests above the configured response cap.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  require = createRequire(root + "/artifacts/mobile/package.json");
const cli =
  root +
  "/node_modules/.pnpm/@supabase+cli-darwin-arm64@2.109.1/node_modules/@supabase/cli-darwin-arm64/bin/supabase";
const backend =
  process.env.SWEETMATE_QA_BACKEND ||
  "/Users/lianawarnakulasooriya/Downloads/SweetMate-codex-qa-browser-preview/.sweetmate-qa/backend";
const raw = execFileSync(
  cli,
  ["status", "--workdir", backend, "--output", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const config = JSON.parse(
  raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
);
assert.equal(config.API_URL, "http://127.0.0.1:54321", "Local QA only");
const { createClient } = require("@supabase/supabase-js"),
  ts = require("typescript");
const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(root + "/artifacts/mobile/lib/pagination.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports, Set, JSON, Number, Array, String },
);
const { fetchAllRows, fetchAllRowsByIds } = exports;
const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: authOptions,
});
const users = [],
  clients = [];
const client = () => {
  const c = createClient(config.API_URL, config.ANON_KEY, {
    auth: authOptions,
    global: { headers: { "x-sweetmate-chore-policy": "single-obligation-v1" } },
  });
  clients.push(c);
  return c;
};
const sql = (text) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_sweetmate-qa",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
const N = 1257,
  prefix = "pagination-" + randomUUID();
let stage = "initialization";
const good = (result, label) => {
  if (result.error) throw Error(label + ": " + (result.error.code || "failed"));
  return result.data;
};
try {
  for (const label of ["owner", "member", "outsider"]) {
    const email = prefix + "-" + label + "@sweetmate.local",
      password = randomBytes(24).toString("base64url");
    const created = good(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      "create disposable account",
    );
    const c = client();
    good(await c.auth.signInWithPassword({ email, password }), "dummy sign-in");
    users.push({ id: created.user.id, email, client: c });
  }
  const [a, b, out] = users;
  const homeRow = good(
    await a.client.rpc("create_household", {
      household_name: "Disposable pagination home",
      member_name: "Pagination A",
      member_color: "#888888",
      requested_invite_code: randomBytes(4).toString("hex").toUpperCase(),
      household_timezone: "America/New_York",
    }),
    "create disposable home",
  )[0];
  const h = homeRow.household_id;
  good(
    await b.client.rpc("join_household", {
      code: homeRow.invite_code,
      member_name: "Pagination B",
      member_color: "#999999",
    }),
    "join disposable home",
  );
  for (const id of [a.id, b.id, h]) assert(/^[0-9a-f-]{36}$/.test(id));
  stage = "seed isolated beyond-limit records";
  sql(`begin;
 insert into public.households(id,name,invite_code,created_by) select md5('${prefix}-home-'||g)::uuid,'Disposable pagination home '||g,upper(substr(md5('${prefix}-invite-'||g),1,8)),'${a.id}' from generate_series(${N},1,-1) g;
 insert into public.household_members(household_id,user_id,display_name,color,role,status,joined_at) select md5('${prefix}-home-'||g)::uuid,'${a.id}','Pagination A','#888888','owner','active','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.chores(id,household_id,title,creator_id,assigned_to,due_date,created_at) select '${prefix}-chore-'||lpad(g::text,5,'0'),'${h}','Dummy chore','${a.id}','${b.id}','2026-12-01','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.shopping_lists(id,household_id,name,sort_order,entry) select '${prefix}-list-'||lpad(g::text,5,'0'),'${h}','Dummy list',g,jsonb_build_object('id','${prefix}-list-'||lpad(g::text,5,'0'),'name','Dummy list') from generate_series(${N},1,-1) g;
 insert into public.shopping_items(id,household_id,list_id,name,sort_order,entry) select '${prefix}-item-'||lpad(g::text,5,'0'),'${h}','${prefix}-list-'||lpad(g::text,5,'0'),'Dummy item',g,'{}'::jsonb from generate_series(${N},1,-1) g;
 insert into public.private_borrow_items(id,household_id,owner_id,entry) select gen_random_uuid(),'${h}','${a.id}',jsonb_build_object('visibility','private','creatorId','${a.id}','ownerId','${a.id}','householdId','${h}') from generate_series(${N},1,-1) g;
 insert into public.shared_borrow_items(id,household_id,creator_id,owner_id,borrowed_from,borrowed_by,due_date,entry) select '${prefix}-borrow-'||g,'${h}','${a.id}','${a.id}','${a.id}','${b.id}','2026-12-01','{"visibility":"shared"}' from generate_series(${N},1,-1) g;
 insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,entry,created_at) select '${prefix}-expense-'||lpad(g::text,5,'0'),'${h}','${a.id}','${a.id}',100,'2026-11-01',jsonb_build_object('id','${prefix}-expense-'||lpad(g::text,5,'0'),'title','Dummy expense','paidBy','${a.id}','amountCents',100,'date','2026-11-01'),'2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.expense_activity(household_id,expense_id,actor_id,action,summary,created_at) select '${h}','${prefix}-expense-'||lpad(g::text,5,'0'),'${a.id}','create','Dummy activity','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.item_difficulty(household_id,category,item,difficulty) select '${h}','other','Dummy item '||g,3 from generate_series(${N},1,-1) g;
 insert into public.member_task_preferences(household_id,member_id,key,value) select '${h}','${a.id}','dummy-key-'||g,50 from generate_series(${N},1,-1) g;
 insert into public.sweet_essential_shortlist_items(household_id,section_key,item_id,added_by) select '${h}','section, "quoted" \\ (test)','item,('||lpad(g::text,5,'0')||')','${a.id}' from generate_series(${N},1,-1) g;
 insert into public.sweet_essential_item_assignments(household_id,section_key,item_id,user_id) select '${h}','section, "quoted" \\ (test)','item,('||lpad(((g+1)/2)::text,5,'0')||')',case when g%2=1 then '${a.id}'::uuid else '${b.id}'::uuid end from generate_series(${N},1,-1) g;
 insert into public.nudges(household_id,to_member_id,chore_id,sent_by,sent_at) select '${h}','${b.id}','${prefix}-chore-'||lpad(g::text,5,'0'),'${a.id}','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.proposed_charts(id,household_id,created_by,status,payload,created_at) select md5('${prefix}-chart-'||g)::uuid,'${h}','${a.id}','cancelled','{}','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.chore_chart_restart_notifications(household_id,chart_id,actor_id,actor_name,recipient_id,created_at) select '${h}',md5('${prefix}-chart-'||g)::uuid,'${a.id}','Pagination A','${b.id}','2026-11-01' from generate_series(${N},1,-1) g;
 insert into public.personal_schedule_items(id,user_id,source,resource_id,provider_id,title,starts_on,ends_on) select '${prefix}-event-'||lpad(g::text,5,'0'),'${a.id}','google-event','dummy-calendar',g::text,'Dummy event','2026-11-01','2026-11-02' from generate_series(${N},1,-1) g;
 commit;`);
  stage = "observe real local API cap";
  const capped = good(
    await a.client.from("shopping_lists").select("*").eq("household_id", h),
    "uncapped request",
  );
  assert.equal(capped.length, 1000);
  console.log(
    "PASS actual local response cap: a single unpaged request returns 1000 of 1257 saved rows",
  );
  const descending = [
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ];
  const specifications = [
    ["shopping_lists", a.client, [{ column: "id" }]],
    ["shopping_items", a.client, [{ column: "id" }]],
    ["chores", a.client, [{ column: "created_at" }, { column: "id" }]],
    ["expenses", a.client, [{ column: "id" }]],
    ["expense_activity", b.client, descending],
    ["shared_borrow_items", b.client, [{ column: "id" }]],
    ["private_borrow_items", a.client, [{ column: "id" }]],
    ["item_difficulty", a.client, [{ column: "id" }]],
    ["member_task_preferences", b.client, [{ column: "id" }]],
    [
      "sweet_essential_shortlist_items",
      b.client,
      [{ column: "section_key" }, { column: "item_id" }],
    ],
    [
      "sweet_essential_item_assignments",
      b.client,
      [{ column: "section_key" }, { column: "item_id" }, { column: "user_id" }],
    ],
    [
      "nudges",
      b.client,
      [
        { column: "sent_at", ascending: false },
        { column: "id", ascending: false },
      ],
    ],
    ["chore_chart_restart_notifications", b.client, descending],
  ];
  for (const [table, c, order] of specifications) {
    stage = "page " + table;
    const query = () =>
      c
        .from(table)
        .select(
          table === "nudges"
            ? "id,to_member_id,chore_id,sent_at,seen,seen_at,dismissed_at"
            : "*",
        )
        .eq("household_id", h);
    const first = good(await fetchAllRows(query, order), "complete " + table),
      again = good(await fetchAllRows(query, order), "repeat " + table);
    const key = (row) =>
      JSON.stringify(order.map((field) => row[field.column]));
    assert.equal(first.length, N, table);
    assert.equal(new Set(first.map(key)).size, N, table + " unique keys");
    assert.deepEqual(
      first.map(key),
      again.map(key),
      table + " stable ordering",
    );
    console.log(
      "PASS " +
        table +
        ": 1257 unique rows, repeated load retains identical order",
    );
  }
  stage = "server cap lower than requested page";
  const largePage = good(
    await fetchAllRows(
      () => a.client.from("shopping_lists").select("*").eq("household_id", h),
      undefined,
      { pageSize: 2000 },
    ),
    "large requested page",
  );
  assert.equal(largePage.length, N);
  console.log(
    "PASS 2000-row requested pages still continue when the real server caps them to 1000",
  );
  stage = "personal schedule privacy";
  const schedule = good(
    await fetchAllRows(() =>
      a.client.from("personal_schedule_items").select("*").eq("user_id", a.id),
    ),
    "personal schedule",
  );
  assert.equal(schedule.length, N);
  assert.equal(
    good(
      await fetchAllRows(() =>
        b.client
          .from("personal_schedule_items")
          .select("*")
          .eq("user_id", a.id),
      ),
      "peer schedule",
    ).length,
    0,
  );
  assert.equal(
    good(
      await fetchAllRows(() =>
        b.client.from("private_borrow_items").select("*").eq("household_id", h),
      ),
      "peer private borrowing",
    ).length,
    0,
  );
  assert.equal(
    good(
      await fetchAllRows(() =>
        out.client.from("shopping_lists").select("*").eq("household_id", h),
      ),
      "unrelated household",
    ).length,
    0,
  );
  console.log(
    "PASS 1257 personal schedule items; peer private borrowing/schedule and unrelated household access remain denied",
  );
  stage = "membership and bounded IN queries";
  const memberships = good(
    await fetchAllRows(
      () =>
        a.client
          .from("household_members")
          .select("household_id,user_id,joined_at")
          .eq("user_id", a.id)
          .eq("status", "active"),
      [{ column: "joined_at" }, { column: "household_id" }],
    ),
    "memberships",
  );
  assert.equal(memberships.length, N + 1);
  const homeIds = memberships.map((row) => row.household_id);
  const homes = good(
    await fetchAllRowsByIds(homeIds, (ids) =>
      a.client.from("households").select("id,name").in("id", ids),
    ),
    "batched homes",
  );
  assert.equal(homes.length, N + 1);
  const counts = good(
    await fetchAllRowsByIds(
      homeIds,
      (ids) =>
        a.client
          .from("household_members")
          .select("household_id,user_id")
          .in("household_id", ids)
          .eq("status", "active"),
      [{ column: "household_id" }, { column: "user_id" }],
    ),
    "batched counts",
  );
  assert.equal(counts.length, N + 2);
  console.log(
    "PASS 1258 memberships/households and 1259 member-count rows with bounded identifier filters",
  );
  stage = "save shortlist once then read all";
  const rpc = await a.client.rpc("save_sweet_essential_shortlist", {
    target_household_id: h,
    selected_items: [{ section_key: "saved-extra", item_id: "saved-once" }],
    removed_items: [],
  });
  good(rpc, "save shortlist");
  assert.equal(rpc.data.length, 1000);
  const saved = good(
    await fetchAllRows(
      () =>
        a.client
          .from("sweet_essential_shortlist_items")
          .select("section_key,item_id")
          .eq("household_id", h),
      [{ column: "section_key" }, { column: "item_id" }],
    ),
    "full saved shortlist",
  );
  assert.equal(saved.length, N + 1);
  assert(saved.some((row) => row.item_id === "saved-once"));
  console.log(
    "PASS mutating shortlist RPC response is capped to 1000; one write plus full read preserves all 1258 saved items",
  );
} catch (error) {
  console.error(
    "FAIL pagination stage:",
    stage,
    "—",
    error instanceof assert.AssertionError
      ? error.message
      : error.message || "request failed",
  );
  process.exitCode = 1;
} finally {
  for (const user of users) {
    assert(
      user.email.startsWith(prefix) && user.email.endsWith("@sweetmate.local"),
    );
    const result = await admin.rpc("finalize_account_deletion", {
      target_user_id: user.id,
      analytics_id: null,
    });
    if (result.error) {
      console.error("FAIL pagination fixture cleanup:", result.error.code);
      process.exitCode = 1;
    }
  }
  for (const c of clients) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
  console.log(
    "Removed only this run’s disposable accounts and their fixture households.",
  );
}
