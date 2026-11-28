import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the real shopping editor state/effects in their source order. Opening
// via navigation must survive the same mount's account/household cleanup effect.
const source = readFileSync("app/(tabs)/shopping.tsx", "utf8");
const start = source.indexOf('  const [shopName, setShopName]');
const end = source.indexOf('  const showFeedback =', start);
assert(start >= 0 && end > start);
const code = ts.transpileModule(`exports.render = () => {
${source.slice(start, end)}
return { visible: showNewListModal, name: newListName, setName: setNewListName };
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(initialToken?: string) {
  const state: any[] = [], effects: any[] = [], pending: Array<() => void> = [];
  let cursor = 0, token = initialToken, clears = 0;
  const scope = { householdId: "home", currentUserId: "avery" };
  const useState = (initial: any) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  };
  const output: any = {};
  runInNewContext(code, { exports: output, Set, Map, clearTimeout,
    get householdId() { return scope.householdId; },
    get currentUserId() { return scope.currentUserId; },
    shoppingLists: [], shoppingItems: [],
    completionOrderRef: { current: new Map() }, setLayoutHoldIds: () => {}, setDragActive: () => {},
    useState, useRef: (value: any) => useState({ current: value })[0],
    useLocalSearchParams: () => ({ add: token }),
    router: { setParams: (params: any) => { assert.equal(params.add, undefined); token = undefined; clears++; } },
    useEffect: (effect: any, deps: any[]) => {
      const index = cursor++, prior = effects[index];
      if (prior && deps.every((value, j) => Object.is(value, prior.deps[j]))) return;
      pending.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    },
  });
  const render = () => { cursor = 0; const tree = output.render(); pending.splice(0).forEach(fn => fn()); return tree; };
  return { render, scope, token: (next: string) => { token = next; }, clears: () => clears };
}
{
  const f = fixture("first-request"); f.render();
  assert.equal(f.render().visible, true, "a quick-add request on first mount must survive scope cleanup");
  assert.equal(f.clears(), 1, "consume each navigation token once");
  f.scope.householdId = "another-home"; f.render();
  assert.equal(f.render().visible, false, "a consumed request cannot reopen after switching households");
  f.token("next-request"); f.render();
  assert.equal(f.render().visible, true, "another quick-add request opens an already mounted tab");
  assert.equal(f.clears(), 2);
}
{
  const f = fixture(); f.render();
  assert.equal(f.render().visible, false, "ordinary navigation does not open an editor");
  f.token("later-request"); f.render(); assert.equal(f.render().visible, true);
  f.scope.currentUserId = "blake"; f.render(); assert.equal(f.render().visible, false);
}
console.log("Shopping quick-add mount, repeated navigation and account/household cleanup passed");
