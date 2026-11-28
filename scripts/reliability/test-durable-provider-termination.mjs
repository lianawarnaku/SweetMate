// Real process death and HTTP, with actual provider handlers and fake external services.
// Never uses real Google credentials, sends email, or calls any external service.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomUUID, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
const root = resolve(import.meta.dirname, "../.."),
  req = createRequire(root + "/artifacts/mobile/package.json"),
  ts = req("typescript");
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path);
  const exports = {};
  modules.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    Date,
    Uint8Array,
    console,
    require: (name) =>
      name.startsWith(".") ? load(resolve(dirname(path), name)) : req(name),
  });
  return exports;
}
const { createCalendarService } = load(
  root + "/supabase/functions/_shared/calendar.ts",
);
const { submissionHandler } = load(
  root + "/supabase/functions/_shared/submission.ts",
);
let connected = true;
const events = new Map(),
  feedback = new Map();
const admin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: connected
            ? {
                refresh_token: "fake-provider-token",
                access_token: "fake-access",
                access_token_expires_at: "2099-01-01T00:00:00Z",
              }
            : null,
          error: null,
        }),
      }),
    }),
    delete: () => ({
      eq: async () => {
        connected = false;
        return { error: null };
      },
    }),
  }),
};
const calendar = createCalendarService(
  admin,
  { clientId: "fake", clientSecret: "fake" },
  async (url, init) => {
    if (url.endsWith("/events")) {
      const event = JSON.parse(init.body);
      if (events.has(event.id)) return new Response("{}", { status: 409 });
      events.set(event.id, event);
      return new Response(JSON.stringify({ id: event.id }), { status: 200 });
    }
    if (url === "https://oauth2.googleapis.com/revoke")
      return new Response("{}", { status: 200 });
    throw Error("Refusing any unexpected upstream request");
  },
);
const submit = submissionHandler({
  authenticate: async (header) => header === "Bearer fake-session",
  save: async (_header, input) => {
    if (!feedback.has(input.request_id))
      feedback.set(input.request_id, { id: randomUUID(), input });
    return { id: feedback.get(input.request_id).id };
  },
  notify: async () => {},
  background: () => {},
});
const server = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    let result;
    if (request.url === "/functions/v1/submit-feedback")
      result = await submit(
        new Request("http://local.invalid" + request.url, {
          method: "POST",
          headers: {
            Authorization: "Bearer fake-session",
            "Content-Type": "application/json",
          },
          body: raw,
        }),
      );
    else if (request.url === "/functions/v1/calendar/add-chore")
      result = new Response(
        JSON.stringify(await calendar.add("fake-user", JSON.parse(raw))),
        { status: 200 },
      );
    else if (request.url === "/functions/v1/calendar/disconnect")
      result = new Response(
        JSON.stringify(await calendar.disconnect("fake-user")),
        { status: 200 },
      );
    else throw Error("Unexpected route");
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(await result.text());
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const dir = await mkdtemp(join(tmpdir(), "sweetmate-provider-kill-")),
  config = dir + "/private.json";
await writeFile(
  config,
  JSON.stringify({
    api: "http://127.0.0.1:54321",
    anon: "fake-anon",
    edgeApi: "http://127.0.0.1:" + server.address().port,
    directory: dir,
  }),
  { mode: 0o600 },
);
const user = { id: "fake-user", token: "fake-session" };
const worker = (phase, request) =>
  new Promise((yes, no) => {
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
      no(Error("Worker timed out"));
    }, 15000);
    child.on("message", (message) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (message.phase === "error") no(Error(message.message));
      else yes(message);
    });
    child.on("error", no);
    child.send({ user, phase, request, scope: "fake-user:home" });
  });
async function check(name, body, count) {
  const request = {
    name,
    edge: true,
    rpc: false,
    method: "POST",
    body,
    query: [],
    prefer: "",
    accept: "",
  };
  await worker("before-send", request);
  const before = JSON.parse(
    await readFile(dir + "/" + user.id + ".json", "utf8"),
  ).operations[0].id;
  await worker("after-commit");
  const expected = count();
  assert.equal(
    JSON.parse(await readFile(dir + "/" + user.id + ".json", "utf8"))
      .operations[0].id,
    before,
  );
  const done = await worker("recover");
  assert.equal(done.pending, 0);
  assert.equal(count(), expected);
  console.log(
    "PASS actual handler + SIGKILL/restart + duplicate-safe provider model: " +
      name,
  );
}
try {
  await check(
    "submit-feedback",
    {
      request_id: randomUUID(),
      category: "bug",
      message: "Disposable termination test",
      contact_email: "",
      app_version: "1.0.0",
      platform: "ios",
    },
    () => feedback.size,
  );
  await check(
    "calendar/add-chore",
    { choreId: "disposable-chore", title: "Test task", dueDate: "2026-12-01" },
    () => events.size,
  );
  assert.equal(events.size, 1);
  await check("calendar/disconnect", null, () => connected);
  assert.equal(connected, false);
  console.log(
    JSON.stringify({
      passed: 3,
      checkpointsPerMutation: 3,
      externalNetwork: false,
    }),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
