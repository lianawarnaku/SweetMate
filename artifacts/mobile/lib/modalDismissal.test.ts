import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function fixture(os = "ios") {
  const slots: any[] = [], effects: any[] = [], pending: (() => void)[] = [];
  let cursor = 0, visible = true, closes = 0, now = 0, nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const react = {
    useRef: (value: any) => { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback: (fn: any, dependencies: any[]) => { const i = cursor++; return slots[i] ??= fn; },
    useEffect: (effect: () => any, dependencies: any[]) => { const i = cursor++, old = effects[i];
      if (old && dependencies.length === old.dependencies.length && dependencies.every((value, j) => Object.is(value, old.dependencies[j]))) return;
      pending.push(() => { old?.cleanup?.(); effects[i] = { dependencies, cleanup: effect() }; });
    },
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("hooks/useModalDismissal.ts", "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react-native") return { Platform: { OS: os } };
    throw Error(name);
  }, setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; }, clearTimeout: (id: number) => timers.delete(id) });
  const render = (next = visible) => { visible = next; cursor = 0; const value = exports.useModalDismissal(visible, () => { closes++; visible = false; }); pending.splice(0).forEach(fn => fn()); return value; };
  return { render, closes: () => closes, unmount: () => effects.forEach(effect => effect?.cleanup?.()),
    advance: (amount: number) => { now += amount; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
  };
}
for (const finished of [true, false, undefined]) {
  const f = fixture(); const modal = f.render(); let done: any, starts = 0;
  const animation = { start: (callback: any) => { starts++; done = callback; } };
  modal.dismiss(animation, 150); modal.dismiss(animation, 150);
  assert.equal(starts, 1, "repeated close taps do not queue duplicate exits");
  if (finished === undefined) { f.advance(249); assert.equal(f.closes(), 0); f.advance(1); }
  else done({ finished });
  assert.equal(f.closes(), 1, "finished, interrupted and missing native callbacks all remove the modal");
  done({ finished: true }); f.advance(1000); assert.equal(f.closes(), 1);
}
for (const nativeSignal of [true, false]) {
  const f = fixture(); const modal = f.render(); let next = 0;
  modal.dismiss(undefined, 0, () => { next++; }); assert.equal(f.closes(), 1);
  f.render(false); assert.equal(next, 0, "iOS handoffs wait until the old presentation is gone");
  if (nativeSignal) modal.onDismiss(); else { f.advance(449); assert.equal(next, 0); f.advance(1); }
  assert.equal(next, 1, "a missing native onDismiss must not lose an Edit/Delete/picker action");
  modal.onDismiss(); f.advance(1000); assert.equal(next, 1, "handoff runs once");
}
for (const os of ["web", "android"]) {
  const f = fixture(os); const modal = f.render(); let next = 0;
  modal.dismiss(undefined, 0, () => { next++; }); assert.equal(next, 0);
  f.render(false); f.advance(0); assert.equal(next, 1, `${os} handoff follows the commit that removes the modal`);
}
{
  const f = fixture(); const modal = f.render(); let next = 0;
  modal.dismiss(undefined, 0, () => { next++; }); f.render(false); f.render(true);
  modal.onDismiss(); f.advance(1000); assert.equal(next, 0, "reopening cancels the previous sheet's queued action");
}
{
  const f = fixture(); const modal = f.render(); let late: any;
  modal.dismiss({ start: (callback: any) => { late = callback; } }, 260);
  f.render(false); f.render(true); late({ finished: false }); f.advance(1000);
  assert.equal(f.closes(), 0, "late animations cannot close a newly opened form");
}
{
  const f = fixture(); const modal = f.render(); let late: any;
  modal.dismiss({ start: (callback: any) => { late = callback; } }, 260);
  f.unmount(); late({ finished: true }); f.advance(1000);
  assert.equal(f.closes(), 0, "unmount cancels pending callbacks and timers");
}
{
  const f = fixture(); f.render().dismiss({ start: () => { throw Error("native animation unavailable"); } }, 200);
  assert.equal(f.closes(), 1, "animation setup errors cannot strand a transparent modal");
}
console.log("Modal interruption, missing callbacks, native handoff, duplicate taps, reopen and unmount tests passed");
