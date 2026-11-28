import assert from "node:assert/strict";
import { SaveFeedbackStore, saveRequest } from "./saveFeedback.ts";
const store = new SaveFeedbackStore(),
  scope = "user:home";
store.setScope(scope);
let finish!: () => void, reject!: (error: Error) => void;
let attempts = 0;
const run = () =>
  store.run(scope, "shopping", "Shopping", run, () => {
    attempts++;
    return new Promise<void>((yes, no) => {
      finish = yes;
      reject = no;
    });
  });
const first = run().catch((error) => error);
assert.equal(store.getSnapshot().issues[0].phase, "pending");
reject(new Error("Do not display this private provider response"));
await first;
assert.equal(store.getSnapshot().issues[0].phase, "failed");
assert(!JSON.stringify(store.getSnapshot()).includes("provider response"));
const retry = store.retry(scope);
const duplicate = store.retry(scope);
assert.equal(
  attempts,
  2,
  "repeated Retry taps share the newly pending attempt",
);
assert.equal(store.getSnapshot().issues[0].phase, "pending");
finish();
await Promise.all([retry, duplicate]);
assert.equal(store.getSnapshot().issues.length, 0);
{
  const old = store.begin(scope, "chore", "Chores", async () => {});
  const newer = store.begin(scope, "chore", "Chores", async () => {});
  store.finish(old, true);
  assert.equal(store.getSnapshot().issues[0].phase, "pending");
  store.finish(newer, true);
  store.finish(old);
  assert.equal(
    store.getSnapshot().issues[0].phase,
    "failed",
    "an old success cannot hide a newer failure",
  );
  store.setScope("different:household");
  await store.retry(scope);
  assert.equal(attempts, 2);
  store.setScope(scope);
  store.finish(newer, true);
  assert.equal(
    store.getSnapshot().issues.length,
    0,
    "returning to a scope cannot revive an earlier session's callbacks",
  );
}
{
  let signal: AbortSignal | undefined;
  await assert.rejects(
    saveRequest((value) => {
      signal = value;
      return new Promise<void>(() => {});
    }, 5),
    /timed out/,
  );
  assert.equal(
    signal?.aborted,
    true,
    "an unresponsive request must leave Saving and become retryable",
  );
  assert.equal(
    await saveRequest(async () => "acknowledged", 50),
    "acknowledged",
  );
}
console.log(
  "Save feedback: immediate pending, explicit failed state, retry coalescing, stale acknowledgements, safe copy, scope isolation and timeout passed.",
);

{
  const ticket = store.begin(
    scope,
    "google",
    "Google schedule",
    async () => {},
  );
  store.finish(ticket, true);
  store.showInline(scope, "google", true);
  assert.deepEqual(
    store.getSnapshot().inlineKeys,
    ["google"],
    "an open detail form owns its save notice",
  );
  store.showInline(scope, "google", false);
  assert.deepEqual(store.getSnapshot().inlineKeys, []);
  store.discard(scope, "google");
  assert.equal(store.getSnapshot().issues.length, 0);
}
