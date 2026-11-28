import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { default: worker } = await import("../dist/server/index.js");
const results = new Map();
async function render(path) {
  if (!results.has(path)) {
    results.set(path, (async () => {
      const response = await worker.fetch(new Request(`https://sweetmate.info${path}`, {
        headers: { accept: "text/html" },
      }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} });
      return { status: response.status, type: response.headers.get("content-type"), html: await response.text() };
    })());
  }
  return results.get(path);
}

for (const [path, title] of [["/", "SweetMate"], ["/privacy", "Privacy Policy"], ["/support", "Support"], ["/delete-account", "Delete your account"], ["/auth/confirm", "One moment"]]) {
  test(`public HTML is available without sign-in at ${path}`, async () => {
    const result = await render(path);
    assert.equal(result.status, 200);
    assert.match(result.type ?? "", /^text\/html\b/i);
    assert(result.html.includes(title));
    assert.doesNotMatch(result.html, /Your site is taking shape|Building your site|codex-preview/);
  });
}

test("homepage exposes the actual public privacy and support routes", async () => {
  const { html } = await render("/");
  for (const path of ["/privacy", "/support", "/delete-account"])
    assert(html.includes(`href="${path}"`), `missing ${path} link`);
  assert(html.includes("https://testflight.apple.com/join/Ee5PRBzr"));
});

test("policy discloses Google, optional telemetry and their distinct choices", async () => {
  const { html } = await render("/privacy");
  for (const phrase of ["November 27, 2026", "Google Calendar and Tasks", "calendar.events", "tasks.readonly", "Limited Use", "PostHog", "Sentry", "off by default", "Separate choice to share chore and item names", "Retention and security", "Account deletion and shared records", "support@sweetmate.info"])
    assert(html.includes(phrase), `missing disclosure: ${phrase}`);
  assert(html.includes("not change the Google originals"));
  assert(html.includes("not guaranteed"));
  assert.doesNotMatch(html, /\[[A-Z][A-Z _]+\]/, "policy must not publish unresolved bracketed placeholders");
});

test("support and deletion offer a real assistance route and explain retained records", async () => {
  const support = (await render("/support")).html;
  const deletion = (await render("/delete-account")).html;
  assert(support.includes('href="mailto:support@sweetmate.info"'));
  assert(support.includes('href="/delete-account"'));
  for (const phrase of ["Deletion is permanent", "imported schedule entries", "Deleted member", "previously exported", "analytics", "verify ownership"])
    assert(deletion.toLowerCase().includes(phrase.toLowerCase()), `missing deletion explanation: ${phrase}`);
  assert(deletion.includes("mailto:support@sweetmate.info?subject=SweetMate%20account%20deletion"));
});

test("confirmation source keeps the existing provider and app-opening path", async () => {
  const source = await readFile(new URL("../app/auth/confirm/page.tsx", import.meta.url), "utf8");
  assert(source.includes("NEXT_PUBLIC_SUPABASE_URL"));
  assert(source.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  assert(source.includes("token_hash"));
  assert(source.includes("/auth/v1/verify"));
  assert(source.includes("sweetmate://auth/callback"));
  assert(source.includes("missing its verification token"));
});

test("an unknown path remains a genuine 404", async () => {
  assert.equal((await render("/qa-nonexistent-page")).status, 404);
});
