// Real SIGKILL/restart tests against LOCAL Auth + PostgREST + PostgreSQL only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, fork } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve, join } from "node:path";
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
});
const dir = await mkdtemp(join(tmpdir(), "sweetmate-termination-")),
  config = dir + "/private.json";
await writeFile(
  config,
  JSON.stringify({ api: c.API_URL, anon: c.ANON_KEY, directory: dir }),
  { mode: 0o600 },
);
const users = [],
  tag = "termination-" + randomUUID(),
  cases = [];
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
const good = (r, label) => {
  if (r.error) throw Error(label + " failed: " + r.error.code);
  return r.data;
};
function worker(user, phase, request, scope, extra = {}) {
  return new Promise((yes, no) => {
    const child = fork(
      root + "/scripts/reliability/durable-operation-worker.mjs",
      [config],
      {
        execArgv: ["--experimental-strip-types"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      no(Error("Worker timed out: " + phase));
    }, 25000);
    let settled = false;
    child.on("error", no);
    child.on("exit", (code) => {
      if (!settled) {
        clearTimeout(timer);
        no(Error("Worker exited before test checkpoint " + code));
      }
    });
    child.on("message", (message) => {
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (message.phase === "error") no(Error(message.message));
      else yes(message);
    });
    child.send({ user, phase, request, scope, ...extra });
  });
}
const rpc = (name, body) => ({
  name,
  rpc: true,
  method: "POST",
  body,
  query: [],
  prefer: "",
  accept: "",
});
const table = (name, body, query = [], method = "POST", extra = {}) => ({
  name,
  rpc: false,
  method,
  body,
  query,
  prefer:
    method === "POST"
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation",
  accept: "",
  ...extra,
});
async function check(label, request, user = users[0], scope) {
  const file = dir + "/" + user.id + ".json";
  await worker(
    user,
    "before-send",
    request,
    scope ??
      user.id +
        ":" +
        (request.body?.target_household_id ??
          request.body?.household_id ??
          "account"),
  );
  const journal = JSON.parse(await readFile(file, "utf8"));
  assert.equal(journal.operations.length, 1);
  const operation = journal.operations[0];
  assert(
    !JSON.stringify(journal).includes(user.token),
    "journal must not contain a bearer token",
  );
  assert.equal(
    sql(
      `select count(*) from public.app_operation_receipts where user_id='${user.id}' and operation_id='${operation.id}'`,
    ),
    "0",
  );
  const committed = await worker(user, "after-commit");
  if (
    !request.rpc &&
    request.method !== "DELETE" &&
    request.prefer.includes("return=representation") &&
    !request.prefer.includes("ignore-duplicates")
  ) {
    assert(
      committed.value.data &&
        (!Array.isArray(committed.value.data) ||
          committed.value.data.length > 0),
      label + " must actually save a visible row",
    );
  }
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).operations[0].id,
    operation.id,
  );
  assert.equal(
    sql(
      `select count(*) from public.app_operation_receipts where user_id='${user.id}' and operation_id='${operation.id}'`,
    ),
    "1",
  );
  const before = sql(
    `select count(*) from public.app_operation_receipts where user_id='${user.id}'`,
  );
  const done = await worker(user, "recover");
  assert.equal(done.pending, 0);
  assert.equal(
    sql(
      `select count(*) from public.app_operation_receipts where user_id='${user.id}'`,
    ),
    before,
  );
  assert.equal(JSON.parse(await readFile(file, "utf8")).operations.length, 0);
  cases.push(label);
  console.log(
    "PASS SIGKILL before send + after commit + receipt replay: " + label,
  );
  return committed.value.data;
}
async function checkExpense(action, home, id, payload, user = users[0]) {
  const extra = { kind: "expense", home };
  const file = dir + "/" + user.id + ".json";
  const version =
    action === "create"
      ? null
      : Number(sql(`select version from public.expenses where id='${id}'`));
  await worker(
    user,
    "before-send",
    { action, expenseId: id, payload, version },
    "",
    extra,
  );
  const operation = JSON.parse(await readFile(file, "utf8")).operations[0];
  assert(operation.operationId);
  assert.equal(
    sql(
      `select count(*) from public.expense_operation_receipts where household_id='${home}' and operation_id='${operation.operationId}'`,
    ),
    "0",
  );
  await worker(user, "after-commit", null, "", extra);
  assert.equal(
    sql(
      `select count(*) from public.expense_operation_receipts where household_id='${home}' and operation_id='${operation.operationId}'`,
    ),
    "1",
  );
  const done = await worker(user, "recover", null, "", extra);
  assert.equal(done.pending, 0);
  assert.equal(
    sql(
      `select count(*) from public.expense_activity where household_id='${home}' and operation_id='${operation.operationId}'`,
    ),
    "1",
  );
  cases.push("expense " + action);
  console.log(
    "PASS SIGKILL before send + after commit + receipt replay: expense " +
      action,
  );
}
try {
  for (const name of ["Owner", "Member"]) {
    const email = tag + "-" + name.toLowerCase() + "@sweetmate.local",
      password = randomBytes(24).toString("base64url");
    const d = good(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      "create disposable",
    );
    const actor = createClient(c.API_URL, c.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = good(
      await actor.auth.signInWithPassword({ email, password }),
      "disposable login",
    );
    users.push({ id: d.user.id, email, token: login.session.access_token });
  }
  const [a, b] = users,
    code = randomBytes(4).toString("hex").toUpperCase();
  const created = await check(
    "create household",
    rpc("create_household", {
      household_name: tag,
      member_name: "Disposable owner",
      member_color: "#888888",
      requested_invite_code: code,
      household_timezone: "America/New_York",
    }),
  );
  const home = created[0].household_id;
  const currentInvite = created[0].invite_code;
  await check(
    "join household",
    rpc("join_household", {
      code: currentInvite,
      member_name: "Disposable member",
      member_color: "#777777",
    }),
    b,
  );
  await check(
    "household preferences bootstrap",
    table(
      "household_preferences",
      { household_id: home, household_complete: false, updated_by: a.id },
      [],
      "POST",
      { prefer: "return=representation" },
    ),
  );
  const profile = { housingType: "apartment", items: [], additionalChores: [] };
  await check(
    "finish setup",
    rpc("finish_household_setup", {
      target_household_id: home,
      home_profile: profile,
    }),
  );
  await check(
    "generated task settings",
    rpc("update_generated_task_settings", {
      target_household_id: home,
      task_id: "test-task",
      task_settings: {
        title: "Disposable task",
        difficulty: 3,
        frequency: "weekly",
      },
    }),
  );
  await check(
    "seed difficulty",
    rpc("seed_item_difficulty", { target_household_id: home }),
  );
  await check(
    "difficulty edit",
    table(
      "item_difficulty",
      {
        household_id: home,
        category: "other",
        item: "Disposable item",
        difficulty: 4,
      },
      [["on_conflict", "household_id,category,item"]],
    ),
  );
  await check(
    "difficulty reset/delete",
    table("item_difficulty", null, [["household_id", "eq." + home]], "DELETE"),
  );
  await check(
    "member preference",
    table(
      "member_task_preferences",
      { household_id: home, member_id: a.id, key: "morning", value: 75 },
      [["on_conflict", "household_id,member_id,key"]],
    ),
  );
  await check(
    "member name/color",
    table(
      "household_members",
      { display_name: "Disposable updated", color: "#999999" },
      [
        ["household_id", "eq." + home],
        ["user_id", "eq." + a.id],
      ],
      "PATCH",
    ),
  );
  const chore = tag + "-chore",
    list = tag + "-list",
    item = tag + "-item",
    borrow = randomUUID();
  await check(
    "chore create",
    table("chores", {
      id: chore,
      household_id: home,
      title: "Disposable chore",
      creator_id: a.id,
      assigned_to: b.id,
      due_date: "2026-12-01T12:00:00Z",
      points: 5,
    }),
  );
  const choreRow = {
    id: chore,
    household_id: home,
    title: "Disposable chore",
    creator_id: a.id,
    assigned_to: b.id,
    due_date: "2026-12-01T12:00:00Z",
    points: 5,
  };
  await check(
    "edit and reassign chore",
    table("chores", { ...choreRow, title: "Edited chore", assigned_to: a.id }),
  );
  await check(
    "bulk create chores",
    table(
      "chores",
      [1, 2].map((n) => ({ ...choreRow, id: tag + "-bulk-" + n })),
    ),
  );
  await check(
    "chore complete",
    table("chores", {
      id: chore,
      household_id: home,
      title: "Disposable chore",
      creator_id: a.id,
      assigned_to: b.id,
      due_date: "2026-12-01T12:00:00Z",
      points: 5,
      completed: true,
      completed_by_user_id: b.id,
      completed_at: "2026-11-27T16:00:00Z",
    }),
  );
  await check(
    "undo chore",
    table("chores", {
      ...choreRow,
      completed: false,
      completed_at: null,
      completed_by_user_id: null,
    }),
  );
  await check(
    "household snapshot/points/custom tasks",
    table("household_states", {
      household_key: home,
      household_id: home,
      state: {
        homeProfile: profile,
        roommates: [{ id: b.id, points: 5 }],
        customTasks: [{ id: "custom", title: "Test" }],
      },
      updated_by: a.id,
    }),
  );
  await check(
    "atomic completion + points",
    rpc("batch", [
      table("chores", {
        id: chore,
        household_id: home,
        title: "Disposable chore",
        creator_id: a.id,
        assigned_to: b.id,
        due_date: "2026-12-01T12:00:00Z",
        points: 5,
        completed: true,
        completed_by_user_id: b.id,
      }),
      table("household_states", {
        household_key: home,
        household_id: home,
        state: { homeProfile: profile, roommates: [{ id: b.id, points: 5 }] },
        updated_by: a.id,
      }),
    ]),
  );
  assert.equal(
    sql(
      `select state->'roommates'->0->>'points' from public.household_states where household_id='${home}'`,
    ),
    "5",
  );
  await check(
    "pickup reward completion transaction",
    rpc("batch", [
      table("chores", {
        ...choreRow,
        completed: true,
        completed_by_user_id: b.id,
      }),
      table("household_states", {
        household_key: home,
        household_id: home,
        state: { homeProfile: profile, roommates: [{ id: b.id, points: 30 }] },
        updated_by: a.id,
      }),
    ]),
  );
  assert.equal(
    sql(
      `select state->'roommates'->0->>'points' from public.household_states where household_id='${home}'`,
    ),
    "30",
  );
  await check(
    "household activity and sleep status",
    table("household_states", {
      household_key: home,
      household_id: home,
      state: {
        homeProfile: profile,
        roommateStatuses: { [a.id]: "asleep" },
        sleepStartedAt: { [a.id]: 1795800000000 },
      },
      updated_by: a.id,
    }),
  );
  await check(
    "essential owned preference",
    table("household_states", {
      household_key: home,
      household_id: home,
      state: {
        homeProfile: profile,
        essentialOwned: { kitchen: { kettle: true } },
      },
      updated_by: a.id,
    }),
  );
  await check(
    "custom task deletion",
    table("household_states", {
      household_key: home,
      household_id: home,
      state: {
        homeProfile: profile,
        customTasks: [],
        customTaskSyncMeta: { deleted: { custom: "2026-11-27T19:00:00Z" } },
      },
      updated_by: a.id,
    }),
  );
  await check(
    "shopping list create/edit",
    table("shopping_lists", {
      id: list,
      household_id: home,
      name: "Disposable groceries",
      sort_order: 0,
      entry: { id: list, name: "Disposable groceries" },
    }),
  );
  await check(
    "shopping item create/check",
    table("shopping_items", {
      id: item,
      household_id: home,
      list_id: list,
      name: "Milk",
      sort_order: 0,
      completed: true,
      entry: { id: item, name: "Milk", completed: true },
    }),
  );
  const listRow = {
    id: list,
    household_id: home,
    name: "Disposable groceries",
    sort_order: 0,
    entry: { id: list, name: "Disposable groceries" },
  };
  await check(
    "pin shopping list",
    table("shopping_lists", { ...listRow, pinned: true }),
  );
  await check(
    "assign shopping list",
    table("shopping_lists", { ...listRow, assigned_to: b.id }),
  );
  await check(
    "schedule shopping list",
    table("shopping_lists", {
      ...listRow,
      planned_date: "2026-12-01",
      entry: { ...listRow.entry, plannedTime: "18:00" },
    }),
  );
  await check(
    "reorder shopping list",
    table("shopping_lists", { ...listRow, sort_order: 2 }),
  );
  const itemRow = {
    id: item,
    household_id: home,
    list_id: list,
    name: "Milk",
    sort_order: 0,
    completed: false,
    entry: { id: item, name: "Milk", completed: false },
  };
  await check("uncheck shopping item", table("shopping_items", itemRow));
  await check(
    "assign shopping item",
    table("shopping_items", {
      ...itemRow,
      entry: { ...itemRow.entry, assignedTo: [b.id] },
    }),
  );
  await check(
    "edit shopping quantity",
    table("shopping_items", {
      ...itemRow,
      entry: { ...itemRow.entry, quantity: "2" },
    }),
  );
  await check(
    "reorder shopping item",
    table("shopping_items", { ...itemRow, sort_order: 3 }),
  );
  await check(
    "mark shopping conversion",
    table("shopping_items", {
      ...itemRow,
      entry: { ...itemRow.entry, convertedExpenseId: tag + "-expense" },
    }),
  );
  await check(
    "shopping item delete",
    table(
      "shopping_items",
      null,
      [
        ["household_id", "eq." + home],
        ["id", "in.(" + item + ")"],
      ],
      "DELETE",
    ),
  );
  await check(
    "shopping list delete",
    table(
      "shopping_lists",
      null,
      [
        ["household_id", "eq." + home],
        ["id", "in.(" + list + ")"],
      ],
      "DELETE",
    ),
  );
  const entry = {
    id: borrow,
    householdId: home,
    ownerId: a.id,
    creatorId: a.id,
    item: "Charger",
    visibility: "private",
    borrowedFrom: a.id,
    borrowedBy: a.id,
    returned: false,
  };
  await check(
    "private borrowing create/edit",
    table(
      "private_borrow_items",
      { id: borrow, household_id: home, owner_id: a.id, entry },
      [],
      "POST",
      { accept: "application/vnd.pgrst.object+json" },
    ),
  );
  await check(
    "edit private borrowing",
    table("private_borrow_items", {
      id: borrow,
      household_id: home,
      owner_id: a.id,
      entry: { ...entry, item: "Updated charger" },
    }),
  );
  await check(
    "private borrowing return",
    table("private_borrow_items", {
      id: borrow,
      household_id: home,
      owner_id: a.id,
      entry: { ...entry, returned: true },
    }),
  );
  await check(
    "private borrowing delete",
    table("private_borrow_items", null, [["id", "eq." + borrow]], "DELETE"),
  );
  await check(
    "shared borrowing create/return",
    table("shared_borrow_items", {
      id: borrow,
      household_id: home,
      creator_id: a.id,
      owner_id: a.id,
      borrowed_from: a.id,
      borrowed_by: b.id,
      due_date: "2026-12-01T12:00:00Z",
      returned: true,
      entry: {
        ...entry,
        visibility: "shared",
        borrowedBy: b.id,
        returned: true,
      },
    }),
  );
  const sharedRow = {
    id: borrow,
    household_id: home,
    creator_id: a.id,
    owner_id: a.id,
    borrowed_from: a.id,
    borrowed_by: b.id,
    due_date: "2026-12-01T12:00:00Z",
    returned: true,
    entry: { ...entry, visibility: "shared", borrowedBy: b.id, returned: true },
  };
  await check(
    "edit shared borrowing",
    table("shared_borrow_items", {
      ...sharedRow,
      entry: { ...sharedRow.entry, item: "Updated shared charger" },
    }),
  );
  await check(
    "return shared borrowing",
    table("shared_borrow_items", sharedRow),
  );
  await check(
    "shared borrowing delete",
    table(
      "shared_borrow_items",
      null,
      [
        ["household_id", "eq." + home],
        ["id", "in.(" + borrow + ")"],
      ],
      "DELETE",
    ),
  );
  await check(
    "essential self assignment",
    table(
      "sweet_essential_item_assignments",
      {
        household_id: home,
        section_key: "kitchen",
        item_id: "kettle",
        user_id: a.id,
      },
      [["on_conflict", "household_id,section_key,item_id,user_id"]],
    ),
  );
  await check(
    "essential self unassignment",
    table(
      "sweet_essential_item_assignments",
      null,
      [
        ["household_id", "eq." + home],
        ["section_key", "eq.kitchen"],
        ["item_id", "eq.kettle"],
        ["user_id", "eq." + a.id],
      ],
      "DELETE",
    ),
  );
  await check(
    "essential shortlist",
    rpc("save_sweet_essential_shortlist", {
      target_household_id: home,
      selected_items: [{ section_key: "kitchen", item_id: "kettle" }],
      removed_items: [],
    }),
  );
  await check(
    "nudge send (server-generated ID)",
    table(
      "nudges",
      {
        household_id: home,
        to_member_id: b.id,
        chore_id: chore,
        sent_by: a.id,
      },
      [],
      "POST",
      { prefer: "" },
    ),
  );
  const nudge = [
    {
      id: sql(
        `select id from public.nudges where household_id='${home}' limit 1`,
      ),
    },
  ];
  await check(
    "nudge read",
    table(
      "nudges",
      { seen: true, seen_at: "2026-11-27T16:00:00Z" },
      [
        ["id", "eq." + nudge[0].id],
        ["household_id", "eq." + home],
        ["to_member_id", "eq." + b.id],
        ["select", "id"],
      ],
      "PATCH",
    ),
    b,
  );
  await check(
    "nudge dismiss",
    table(
      "nudges",
      { dismissed_at: "2026-11-27T17:00:00Z" },
      [
        ["id", "eq." + nudge[0].id],
        ["household_id", "eq." + home],
        ["to_member_id", "eq." + b.id],
        ["select", "id"],
      ],
      "PATCH",
    ),
    b,
  );
  await check(
    "nudge remove",
    table(
      "nudges",
      null,
      [
        ["household_id", "eq." + home],
        ["to_member_id", "eq." + b.id],
        ["chore_id", "eq." + chore],
      ],
      "DELETE",
      { prefer: "" },
    ),
  );
  await check(
    "recurrence occurrence claim",
    table(
      "recurring_chore_occurrence_keys",
      {
        household_id: home,
        recurrence_series_id: tag + "-series",
        scheduled_date: "2026-12-01",
        occurrence_id: chore,
      },
      [["on_conflict", "household_id,recurrence_series_id,scheduled_date"]],
      "POST",
      { prefer: "resolution=ignore-duplicates,return=representation" },
    ),
  );
  const payload = {
    version: 2,
    rotation: "round-robin",
    generatedTasks: [],
    assignments: [a.id, b.id].map((memberId) => ({
      memberId,
      taskIds: [],
      totalLoad: 0,
    })),
    existingLoads: {},
    pinnedAssignments: {},
    excludedAssignments: {},
  };
  let chart = await check(
    "propose chart",
    rpc("replace_proposed_chart", {
      target_household_id: home,
      chart_payload: payload,
    }),
  );
  chart = await check(
    "revise chart",
    rpc("submit_chore_chart_review", {
      target_household_id: home,
      chart_payload: payload,
      expected_chart_id: chart,
      approve_self: false,
    }),
  );
  await check(
    "approve chart owner",
    rpc("approve_proposed_chart", { target_chart_id: chart }),
  );
  await check(
    "approve chart member",
    rpc("approve_proposed_chart", { target_chart_id: chart }),
    b,
  );
  await check(
    "apply approved chart",
    rpc("apply_approved_chore_chart", {
      target_chart_id: chart,
      chore_rows: [],
    }),
  );
  chart = await check(
    "restart chart (one new chart/notification)",
    rpc("restart_chore_chart_review", { target_household_id: home }),
  );
  await check(
    "force approve chart",
    rpc("force_approve_proposed_chart", { target_chart_id: chart }),
  );
  await check(
    "cancel charts",
    rpc("cancel_proposed_charts", { target_household_id: home }),
  );
  const notice = sql(
    `select id from public.chore_chart_restart_notifications where household_id='${home}' and recipient_id='${b.id}' limit 1`,
  );
  await check(
    "restart alert read",
    table(
      "chore_chart_restart_notifications",
      { read_at: "2026-11-27T18:00:00Z" },
      [
        ["id", "eq." + notice],
        ["household_id", "eq." + home],
        ["recipient_id", "eq." + b.id],
        ["read_at", "is.null"],
      ],
      "PATCH",
    ),
    b,
  );
  const random = randomUUID();
  await check(
    "random task create/assignment",
    rpc("create_household_random_task", {
      target_household_id: home,
      task_id: random,
      task_title: "Disposable random",
      task_mode: "up-for-grabs",
    }),
  );
  await check(
    "random task claim",
    rpc("claim_household_random_task", {
      target_household_id: home,
      task_id: random,
    }),
    b,
  );
  const event = tag + "-event",
    task = tag + "-task";
  sql(
    `insert into public.personal_schedule_items(id,user_id,source,resource_id,provider_id,title) values('${event}','${a.id}','google-event','test','event','Disposable event'),('${task}','${a.id}','google-task','test','task','Disposable task')`,
  );
  await check(
    "configure Google household calendars",
    rpc("configure_household_schedule", {
      target_household_id: home,
      calendar_ids: ["test"],
      task_list_ids: ["test"],
      schedule_timezone: "America/New_York",
      enable_sync: true,
    }),
  );
  await check(
    "Google busy sharing",
    rpc("set_schedule_busy_sharing", {
      target_household_id: home,
      share_busy: true,
    }),
  );
  await check(
    "disable Google busy sharing",
    rpc("set_schedule_busy_sharing", {
      target_household_id: home,
      share_busy: false,
    }),
  );
  await check(
    "Google event check",
    rpc("update_personal_schedule_task", { task_id: event, completed: true }),
  );
  await check(
    "Google task check",
    rpc("update_personal_schedule_task", { task_id: task, completed: true }),
  );
  await check(
    "Google task undo and time edit",
    rpc("update_personal_schedule_task", {
      task_id: task,
      completed: false,
      task_period: "night",
      time_start: "2026-12-01T19:00:00Z",
      time_end: "2026-12-01T20:00:00Z",
      clear_time: false,
    }),
  );
  await check(
    "Google task clear time",
    rpc("update_personal_schedule_task", { task_id: task, clear_time: true }),
  );
  await check(
    "disable Google calendar sources",
    rpc("configure_household_schedule", {
      target_household_id: home,
      calendar_ids: [],
      task_list_ids: [],
      schedule_timezone: "America/New_York",
      enable_sync: false,
    }),
  );
  await check(
    "chore delete",
    table(
      "chores",
      null,
      [
        ["household_id", "eq." + home],
        ["id", "in.(" + chore + ")"],
      ],
      "DELETE",
    ),
  );
  const expenseId = tag + "-expense",
    bill = {
      title: "Disposable bill",
      amountCents: 1000,
      paidBy: a.id,
      sharedWith: [a.id, b.id],
      allocations: [
        { participantId: a.id, amountCents: 500 },
        { participantId: b.id, amountCents: 500 },
      ],
      date: "2026-11-27",
      category: "other",
    };
  await checkExpense("create", home, expenseId, bill);
  await checkExpense("update", home, expenseId, {
    ...bill,
    title: "Disposable bill updated",
  });
  await checkExpense(
    "repay",
    home,
    expenseId,
    { amountCents: 100, date: "2026-11-27" },
    b,
  );
  const payment = sql(
    `select id from public.expense_payments where expense_id='${expenseId}' limit 1`,
  );
  await checkExpense("undo_repay", home, expenseId, { paymentId: payment }, b);
  await checkExpense("settle", home, expenseId, {});
  await checkExpense("reopen", home, expenseId, {});
  await checkExpense("delete", home, expenseId, {});
  await checkExpense("restore", home, expenseId, {});
  const execute = async (user, operation, request) => {
    const response = await fetch(
      c.API_URL + "/rest/v1/rpc/execute_app_operation",
      {
        method: "POST",
        headers: {
          apikey: c.ANON_KEY,
          Authorization: "Bearer " + user.token,
          "Content-Type": "application/json",
          "x-sweetmate-chore-policy": "single-obligation-v1",
        },
        body: JSON.stringify({
          operation_id: operation,
          operation_request: request,
        }),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  const concurrent = randomUUID(),
    nudgeRequest = table(
      "nudges",
      {
        household_id: home,
        to_member_id: b.id,
        chore_id: sql(
          `select id from public.chores where household_id='${home}' and not completed limit 1`,
        ),
        sent_by: a.id,
      },
      [],
      "POST",
      { prefer: "" },
    );
  const results = await Promise.all([
    execute(a, concurrent, nudgeRequest),
    execute(a, concurrent, nudgeRequest),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].status, 200);
  assert.equal(
    sql(`select count(*) from public.nudges where household_id='${home}'`),
    "1",
  );
  assert.equal(
    (
      await execute(a, concurrent, {
        ...nudgeRequest,
        body: { ...nudgeRequest.body, chore_id: "changed" },
      })
    ).status,
    400,
  );
  assert.equal((await execute(b, concurrent, nudgeRequest)).status, 403);
  const probe = await execute(
    b,
    randomUUID(),
    table(
      "nudges",
      { seen: true },
      [
        ["household_id", "eq." + home],
        ["select", "sent_by"],
      ],
      "PATCH",
    ),
  );
  assert.equal(probe.status, 403);
  const badPrivate = {
    id: randomUUID(),
    household_id: home,
    owner_id: a.id,
    entry,
  };
  assert.equal(
    (await execute(b, randomUUID(), table("private_borrow_items", badPrivate)))
      .status,
    403,
  );
  const rollbackId = tag + "-rollback",
    rollbackReceipt = randomUUID();
  assert.equal(
    (
      await execute(
        b,
        rollbackReceipt,
        rpc("batch", [
          table("chores", {
            id: rollbackId,
            household_id: home,
            title: "Must roll back",
            creator_id: b.id,
            assigned_to: b.id,
            due_date: "2026-12-01T12:00:00Z",
            points: 1,
          }),
          table("private_borrow_items", badPrivate),
        ]),
      )
    ).status,
    403,
  );
  assert.equal(
    sql(`select count(*) from public.chores where id='${rollbackId}'`),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.app_operation_receipts where user_id='${b.id}' and operation_id='${rollbackReceipt}'`,
    ),
    "0",
  );
  assert.equal(
    (await execute(a, randomUUID(), table("auth.users", {}))).status,
    400,
  );
  const snapshotReceipt = randomUUID(),
    snapshot = table("household_states", {
      household_key: home,
      household_id: home,
      state: { homeProfile: profile, roommates: [{ id: a.id, points: 5 }] },
      updated_by: a.id,
    });
  assert.equal((await execute(a, snapshotReceipt, snapshot)).status, 200);
  sql(
    `update public.household_states set state=jsonb_set(state,'{roommates,0,points}','9') where household_id='${home}'`,
  );
  assert.equal((await execute(a, snapshotReceipt, snapshot)).status, 200);
  assert.equal(
    sql(
      `select state->'roommates'->0->>'points' from public.household_states where household_id='${home}'`,
    ),
    "9",
  );
  console.log(
    "PASS concurrent receipt reuse, changed-payload rejection, account/RLS isolation, anonymous sender protection, batch rollback, whitelist and newer-peer-state preservation",
  );
  await check(
    "leave household",
    rpc("leave_household", { target_household_id: home }),
    b,
  );
  await check(
    "rejoin household",
    rpc("join_household", {
      code: currentInvite,
      member_name: "Disposable member",
      member_color: "#777777",
    }),
    b,
  );
  await check(
    "remove household member",
    rpc("remove_household_member", {
      target_household_id: home,
      target_user_id: b.id,
    }),
  );
  await check(
    "delete household",
    rpc("delete_household", { target_household_id: home }),
  );
  console.log(
    JSON.stringify({
      passed: cases.length,
      checkpointsPerMutation: 3,
      localOnly: true,
    }),
  );
} catch (error) {
  console.error("Termination audit failed:", error.message);
  process.exitCode = 1;
} finally {
  for (const user of users) {
    if (!user.email.startsWith(tag + "-"))
      throw Error("Cleanup scope mismatch");
    good(
      await admin.rpc("finalize_account_deletion", {
        target_user_id: user.id,
        analytics_id: null,
      }),
      "cleanup disposable",
    );
  }
  await rm(dir, { recursive: true, force: true });
  console.log(
    "Removed only disposable termination-audit accounts and their data.",
  );
}
