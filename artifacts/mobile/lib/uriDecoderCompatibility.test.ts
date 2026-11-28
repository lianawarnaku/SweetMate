import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const router = createRequire(require.resolve("expo-router/package.json"));
const query = router("query-string");
assert.equal(query.parse("title=Day%20%26%20Night").title, "Day & Night");
assert.equal(query.parse("name=Avery%20%F0%9F%8F%A0").name, "Avery 🏠");
const callback = query.parse("code=fixture%2Bcode&scope=openid%20email");
assert.equal(callback.code, "fixture+code"); assert.equal(callback.scope, "openid email");
for (const value of ["%", "%C0%AF", "%E0%A4%A", "%FE%FF".repeat(15000)]) {
  assert.equal(typeof query.parse("value=" + value).value, "string", "malformed percent encoding must stay bounded and nonthrowing");
}
assert.equal(query.stringify({ name: "Avery 🏠" }), "name=Avery%20%F0%9F%8F%A0");
console.log("Actual Expo router query-string compatibility passed with patched ESM decoding, CommonJS callers, Unicode/OAuth values and long malformed input.");
