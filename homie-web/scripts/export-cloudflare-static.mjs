// Render the existing website to static Pages assets. No framework server or
// server credentials are uploaded. The confirmation effect comes from its source.
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from "node:fs/promises";
import { resolve, relative, dirname, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "out");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url !== "https://eqnogaftebuqfwwelbdx.supabase.co" || !key) throw Error("Use the existing production Supabase URL and public client key.");
let publicKey = key.startsWith("sb_publishable_");
try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role === "anon"; } catch {}
if (!publicKey) throw Error("Only a publishable or anonymous client key is allowed; never a server key.");
const { default: worker } = await import("../dist/server/index.js");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const assets = resolve(root, "dist/client");
async function copyAssets(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const source = resolve(folder, entry.name);
    if (entry.isDirectory()) { if (!entry.name.startsWith(".")) await copyAssets(source); }
    else if ([".css", ".woff2", ".woff", ".svg", ".png", ".ico", ".jpg", ".webp"].includes(extname(entry.name))) {
      const target = resolve(output, relative(assets, source));
      await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
    }
  }
}
await copyAssets(assets);
async function render(path) {
  const response = await worker.fetch(new Request("https://sweetmate.info" + path, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} });
  if (response.status !== (path === "/qa-nonexistent-page" ? 404 : 200)) throw Error("Unexpected status for " + path);
  return (await response.text())
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b(?=[^>]*(?:rel=["']modulepreload["']|as=["']script["']))[^>]*>/gi, "");
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const pageHashes = {};
for (const [path, file] of [["/", "index.html"], ["/privacy", "privacy.html"], ["/support", "support.html"], ["/delete-account", "delete-account.html"], ["/auth/confirm", "auth/confirm.html"], ["/qa-nonexistent-page", "404.html"]]) {
  let html = await render(path);
  if (/<script\b/i.test(html)) throw Error("Unexpected executable content in static page");
  if (path === "/auth/confirm") html = html.replace("</body>", '<script src="/auth-confirm.js" defer></script></body>');
  const target = resolve(output, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, html);
  pageHashes[path] = digest(html);
}
// Reuse, rather than reimplement, the exact provider request and error handling.
const original = await readFile(resolve(root, "app/auth/confirm/page.tsx"), "utf8");
const parsed = ts.createSourceFile("confirm.tsx", original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function find(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
    if (effect) throw Error("Review confirmation export: multiple effects found");
    effect = node.arguments[0];
  }
  ts.forEachChild(node, find);
}
find(parsed);
if (!effect) throw Error("Confirmation effect not found");
let logic = effect.getText(parsed)
  .replaceAll("process.env.NEXT_PUBLIC_SUPABASE_URL", JSON.stringify(url))
  .replaceAll("process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY", JSON.stringify(key));
if (/process\.env/.test(logic)) throw Error("Unexpected environment dependency in confirmation effect");
const compiled = ts.transpileModule("(" + logic + ")();", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const bootstrap = `(() => {
  const card = document.querySelector(".confirmation-card");
  const heading = card.querySelector("h1"), copy = card.querySelector(".confirmation-copy"), mark = card.querySelector(".status-mark");
  let state = "checking", message = "Confirming your email…", scheduled = false;
  function render() {
    scheduled = false;
    heading.textContent = state === "checking" ? "One moment" : state === "confirmed" ? "You’re all set" : "That link didn’t work";
    copy.textContent = message;
    mark.className = "status-mark status-" + state;
    mark.textContent = state === "confirmed" ? "✓" : state === "error" ? "!" : "";
    card.querySelector(".full-width")?.remove(); card.querySelector(".small-copy")?.remove();
    if (state === "confirmed") {
      const link = document.createElement("a"); link.className = "primary-button full-width"; link.href = "sweetmate://auth/callback"; link.textContent = "Open SweetMate";
      card.insertBefore(link, card.querySelector(".text-link"));
    } else if (state === "error") {
      const help = document.createElement("p"); help.className = "small-copy"; help.textContent = "Open SweetMate and choose Resend confirmation to receive a fresh link.";
      card.insertBefore(help, card.querySelector(".text-link"));
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(render); } }
  function setState(next) { state = next; schedule(); }
  function setMessage(next) { message = next; schedule(); }
  ${compiled}
})();`;
await writeFile(resolve(output, "auth-confirm.js"), bootstrap);
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src " + url + "; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'";
await writeFile(resolve(output, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${csp}\n\n/auth/confirm*\n  Cache-Control: no-store\n\n/404.html\n  X-Robots-Tag: noindex\n`);
await mkdir(resolve(root, "outputs"), { recursive: true });
await writeFile(resolve(root, "outputs/cloudflare-static-manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sourceConfirmationHash: digest(original), pageHashes, confirmationScriptHash: digest(bootstrap), frameworkRuntimeUploaded: false }, null, 2));
console.log("Static Pages output ready: home, privacy, support, deletion and unchanged confirmation request logic. Public client configuration only; no framework server or privileged credentials.");
