import { strict as assert } from "node:assert";
import {
  houseMonitorCompletionTokens,
  parseStoredHouseMonitorSeen,
  getHouseMonitorUnseenCount,
  houseMonitorSeenStorageKey,
} from "./houseMonitorSeen.ts";

const firstTime = "2026-11-08T12:00:00.000Z";
const secondTime = "2026-11-08T12:30:00.000Z";
const chores = [
  { id: "b", completed: true, completedAt: firstTime },
  { id: "a", completed: true },
  { id: "b", completed: true, completedAt: firstTime },
  { id: "c", completed: false, completedAt: secondTime },
];
const tokens = houseMonitorCompletionTokens(chores);
assert.deepEqual(tokens, ["a|completed", `b|${firstTime}`]);
assert.deepEqual(houseMonitorCompletionTokens([]), []);
for (const equivalent of [
  "2026-11-08T12:00:00+00:00",
  "2026-11-08T07:00:00.000-05:00",
  "2026-11-08T12:00:00.000000+00:00",
])
  assert.deepEqual(
    houseMonitorCompletionTokens([{ id: "b", completed: true, completedAt: equivalent }]),
    [`b|${firstTime}`],
    "equivalent database and optimistic timestamps must retain one identity",
  );
assert.deepEqual(
  houseMonitorCompletionTokens([{ id: "legacy", completed: true, completedAt: "" }]),
  ["legacy|completed"],
);
assert.deepEqual(parseStoredHouseMonitorSeen(JSON.stringify(tokens)), tokens);
assert.deepEqual(parseStoredHouseMonitorSeen("[]"), []);
assert.deepEqual(
  parseStoredHouseMonitorSeen(JSON.stringify([...tokens, ...tokens].reverse())),
  tokens,
);
for (const raw of [
  null,
  undefined,
  "",
  "{broken",
  "null",
  "{}",
  '"a|completed"',
  '["a|completed",42]',
  '["a|completed",null]',
  '["no-separator"]',
  '["|completed"]',
  '["a|"]',
])
  assert.equal(parseStoredHouseMonitorSeen(raw), null);

assert.equal(getHouseMonitorUnseenCount(tokens, null), 2, "first visit celebrates current work once");
assert.equal(getHouseMonitorUnseenCount(tokens, []), 2);
assert.equal(getHouseMonitorUnseenCount(tokens, tokens), 0, "next focus cannot replay acknowledged work");
assert.equal(getHouseMonitorUnseenCount([...tokens, ...tokens], [tokens[0]]), 1);
assert.equal(getHouseMonitorUnseenCount([], tokens), 0);

// Editing the title or updatedAt must not replay an existing completion.
const edited = {
  id: "b",
  completed: true,
  completedAt: firstTime,
  updatedAt: secondTime,
  title: "Changed the wording",
};
assert.equal(getHouseMonitorUnseenCount(houseMonitorCompletionTokens([edited]), tokens), 0);

// A different finished chore replaces one removed/undone chore: net total is
// unchanged, but that new completion still deserves one catch-up animation.
const replacement = houseMonitorCompletionTokens([
  { id: "a", completed: false },
  { id: "b", completed: true, completedAt: firstTime },
  { id: "c", completed: true, completedAt: secondTime },
]);
assert.equal(replacement.length, tokens.length);
assert.equal(getHouseMonitorUnseenCount(replacement, tokens), 1);

const undone = houseMonitorCompletionTokens([{ id: "b", completed: false }]);
assert.equal(getHouseMonitorUnseenCount(undone, tokens), 0);
const redone = houseMonitorCompletionTokens([
  { id: "b", completed: true, completedAt: secondTime },
]);
assert.equal(getHouseMonitorUnseenCount(redone, tokens), 1, "re-completion has a fresh identity");
assert.equal(getHouseMonitorUnseenCount(redone, [...tokens, ...redone]), 0);
assert.equal(
  getHouseMonitorUnseenCount(houseMonitorCompletionTokens([edited]), [...tokens, ...redone]),
  0,
  "retaining seen identities prevents a stale completion snapshot replaying",
);

const key = houseMonitorSeenStorageKey("person-a", "home-a");
assert.equal(key, houseMonitorSeenStorageKey("person-a", "home-a"));
assert.notEqual(key, houseMonitorSeenStorageKey("person-b", "home-a"));
assert.notEqual(key, houseMonitorSeenStorageKey("person-a", "home-b"));
assert.notEqual(
  houseMonitorSeenStorageKey("person/home", "one"),
  houseMonitorSeenStorageKey("person", "home/one"),
  "scope separators cannot collide with IDs",
);
assert.notEqual(
  houseMonitorSeenStorageKey("a/b", "home"),
  houseMonitorSeenStorageKey("a%2Fb", "home"),
);
console.log("House Monitor seen-completion tests passed");
