import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const script = await readFile(resolve(root, "out/auth-confirm.js"), "utf8");
for (const file of ["index.html", "privacy.html", "support.html", "delete-account.html"]) {
  test(`static ${file} works without a framework runtime`, async () => {
    const html = await readFile(resolve(root, "out", file), "utf8");
    assert.match(html, /SweetMate/); assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /as="script"|rel="modulepreload"/);
  });
}
test("confirmation is the only executable asset and safe headers accompany it", async () => {
  const files = await readdir(resolve(root, "out"), { recursive: true });
  assert.deepEqual(files.filter(name => /\.(?:[cm]?js|map|tsx?)$/.test(name)), ["auth-confirm.js"]);
  assert(!files.some(name => /(?:^|\/)(?:\.env|node_modules|_worker\.js|functions|hosting\.json)/.test(name)));
  const html = await readFile(resolve(root, "out/auth/confirm.html"), "utf8");
  assert.match(html, /<script src="\/auth-confirm\.js" defer><\/script>/);
  assert.doesNotMatch(script, /process\.env|service_role|sb_secret_|require\(/);
  const headers = await readFile(resolve(root, "out/_headers"), "utf8");
  assert.match(headers, /Referrer-Policy: no-referrer/); assert.match(headers, /Cache-Control: no-store/);
  assert.match(headers, /script-src 'self'/);
});
function browserFixture(search, response = { ok: true, json: async () => ({}) }) {
  const elements = new Map([['h1', {}], ['.confirmation-copy', {}], ['.status-mark', {}], ['.text-link', {}]]);
  const added = [];
  const card = {
    querySelector: (name) => elements.get(name) ?? added.find(node => node.className?.split(' ').includes(name.slice(1))) ?? null,
    insertBefore: (node) => { node.remove = () => { const i = added.indexOf(node); if (i >= 0) added.splice(i, 1); }; added.push(node); },
  };
  const calls = [];
  runInNewContext(script, { document: { querySelector: () => card, createElement: () => ({}) },
    window: { location: { search } }, URLSearchParams, queueMicrotask,
    fetch: async (url, options) => { calls.push({ url, options }); if (response instanceof Error) throw response; return response; },
  });
  return { elements, added, calls };
}
const settle = () => new Promise(setImmediate);
test("missing token makes no provider request and offers a fresh-link path", async () => {
  const f = browserFixture(""); await settle();
  assert.equal(f.calls.length, 0); assert.equal(f.elements.get('h1').textContent, 'That link didn’t work');
  assert.match(f.elements.get('.confirmation-copy').textContent, /missing its verification token/);
  assert(!f.added.some(node => node.href));
});
test("valid confirmation uses existing production Auth endpoint and returns to the same app scheme", async () => {
  const f = browserFixture('?token_hash=qa-test-token&type=email'); await settle();
  assert.equal(f.calls.length, 1); const request = f.calls[0];
  assert.equal(request.url, 'https://eqnogaftebuqfwwelbdx.supabase.co/auth/v1/verify');
  assert.equal(request.options.method, 'POST'); assert.deepEqual(JSON.parse(request.options.body), { token_hash: 'qa-test-token', type: 'email' });
  assert.equal(f.elements.get('h1').textContent, 'You’re all set');
  assert(f.added.some(node => node.href === 'sweetmate://auth/callback'));
});
test("expired link never shows the app-opening success action", async () => {
  const f = browserFixture('?token_hash=qa-expired', { ok: false, json: async () => ({ msg: 'Token has expired' }) }); await settle();
  assert.match(f.elements.get('.confirmation-copy').textContent, /expired/); assert(!f.added.some(node => node.href));
});
test("provider/network failure stays recoverable without false success", async () => {
  const f = browserFixture('?token_hash=qa-failed', new Error('Network unavailable')); await settle();
  assert.equal(f.elements.get('h1').textContent, 'That link didn’t work'); assert(!f.added.some(node => node.href));
});
