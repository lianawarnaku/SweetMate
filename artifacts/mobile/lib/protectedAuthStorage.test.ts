import assert from "node:assert/strict";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createProtectedAuthStorage, type AuthStore } from "./protectedAuthStorage.ts";

function memory() {
  const values = new Map<string, string>();
  let fail: ((op: string, key: string) => boolean) | null = null;
  const check = (op: string, key: string) => { if (fail?.(op, key)) throw new Error("sensitive upstream details must not escape"); };
  const store: AuthStore = {
    getItem: async key => { check("get", key); return values.get(key) ?? null; },
    setItem: async (key, value) => { check("set", key); values.set(key, value); },
    removeItem: async key => { check("remove", key); values.delete(key); },
  };
  return { values, store, fault: (fn: typeof fail) => { fail = fn; } };
}
// Exercise the actual native adapter, with Node's AES-GCM implementing the installed
// Expo bridge contract. This checks encoding, random nonces, AAD, vault options and size.
function fixture() {
  const disk = memory(), vault = memory();
  let protectedModule: any = {};
  const compile = (p: string) => ts.transpileModule(readFileSync(p, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: false } }).outputText;
  const bytes = (s: any) => typeof s === "string" ? Buffer.from(s, "base64") : Buffer.from(s);
  const expo = {
    AESEncryptionKey: { generate: async () => ({ encoded: async () => randomBytes(32).toString("base64") }), import: async (key: string) => bytes(key) },
    AESSealedData: { fromCombined: bytes },
    aesEncryptAsync: async (plain: Uint8Array, key: Buffer, options: any) => {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(bytes(options.additionalData));
      const sealed = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      return { combined: async () => sealed.toString("base64") };
    },
    aesDecryptAsync: async (sealed: Buffer, key: Buffer, options: any) => {
      const cipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
      cipher.setAAD(bytes(options.additionalData)); cipher.setAuthTag(sealed.subarray(-16));
      return Buffer.concat([cipher.update(sealed.subarray(12, -16)), cipher.final()]);
    },
  };
  function restart() {
    const exports: any = {};
    runInNewContext(compile("lib/authStorage.native.ts"), { exports, TextEncoder, TextDecoder, require: (name: string) => {
      if (name === "@react-native-async-storage/async-storage") return { default: disk.store };
      if (name === "./protectedAuthStorage") return { createProtectedAuthStorage };
      if (name === "expo-crypto") return expo;
      if (name === "expo-secure-store") return {
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "device-only", getItemAsync: vault.store.getItem,
        setItemAsync: async (key: string, value: string, options: any) => {
          assert.equal(options.keychainAccessible, "device-only"); assert.equal(options.requireAuthentication, undefined);
          assert(value.length < 2048, "only a small encryption key enters SecureStore"); await vault.store.setItem(key, value);
        }, deleteItemAsync: vault.store.removeItem,
      };
      throw Error(name);
    } });
    protectedModule = exports; return exports.authStorage as AuthStore;
  }
  return { disk, vault, restart, store: restart() };
}
const key = "sb-test-auth-token", legacy = JSON.stringify({ access_token: "fixture-only-access", refresh_token: "fixture-only-refresh", user: { name: "Avery 🏠", metadata: "é".repeat(70000) } });
{
  const f = fixture(); f.disk.values.set(key, legacy);
  assert.equal(await f.store.getItem(key), legacy); assert(!f.disk.values.has(key));
  const sealed = f.disk.values.get(key + ".encrypted-v1")!;
  assert(!sealed.includes("fixture-only")); assert.equal(await f.restart().getItem(key), legacy);
  await f.store.setItem(key, legacy); assert.notEqual(f.disk.values.get(key + ".encrypted-v1"), sealed, "fresh random nonce");
  await f.store.removeItem(key); assert.equal(await f.restart().getItem(key), null); assert.equal(f.vault.values.size, 0);
}
for (const point of ["vault-write", "ciphertext-write", "legacy-delete"]) {
  const f = fixture(); f.disk.values.set(key, legacy);
  if (point === "vault-write") f.vault.fault(op => op === "set");
  else f.disk.fault((op, k) => point === "ciphertext-write" ? op === "set" && k.endsWith(".encrypted-v1") : op === "remove" && k === key);
  await assert.rejects(f.store.getItem(key), /Protected sign-in storage/);
  f.vault.fault(null); f.disk.fault(null);
  assert.equal(await f.restart().getItem(key), legacy, "interrupted migration remains recoverable");
  assert(!f.disk.values.has(key));
}
{
  const f = fixture(); await f.store.setItem(key, legacy);
  f.vault.fault(() => true); await assert.rejects(f.store.getItem(key), /Unlock your device/);
  f.vault.fault(null); assert.equal(await f.restart().getItem(key), legacy, "temporary lock never deletes credentials");
  f.vault.values.clear(); f.disk.values.set(key, legacy);
  assert.equal(await f.restart().getItem(key), null, "backup without device key cannot restore plaintext");
}
{
  const f = fixture(); await f.store.setItem(key, legacy);
  const intact = f.disk.values.get(key + ".encrypted-v1")!;
  const parsed = JSON.parse(intact); parsed.data = parsed.data.slice(0, -6) + "AAAAAA";
  f.disk.values.set(key + ".encrypted-v1", JSON.stringify(parsed)); f.disk.values.set(key, legacy);
  await assert.rejects(f.restart().getItem(key), /Protected sign-in storage/, "tampering cannot fall back to plaintext");
  f.disk.values.set("other.encrypted-v1", intact);
  f.vault.values.set("sweetmate.auth.v1.other", f.vault.values.get("sweetmate.auth.v1." + key)!);
  await assert.rejects(f.store.getItem("other"), /Protected sign-in storage/, "AAD prevents swapping session namespaces");
}
{
  const f = fixture(); await f.store.setItem(key, legacy); f.disk.values.set(key, legacy);
  f.disk.fault((op, k) => op === "remove" && k === key);
  await assert.rejects(f.store.removeItem(key), /Protected sign-in storage/);
  f.disk.fault(null); assert.equal(await f.restart().getItem(key), null, "interrupted logout cannot revive legacy tokens");
  await f.store.removeItem(key); assert.equal(f.vault.values.size, 0);
}
{
  const f = fixture(); await Promise.all([f.store.setItem(key, "first"), f.store.setItem(key, "second"), f.store.removeItem(key), f.store.setItem(key, "new-account")]);
  assert.equal(await f.restart().getItem(key), "new-account");
  f.disk.values.clear(); assert.equal(await f.restart().getItem(key), null, "iOS vault surviving uninstall does not resurrect a session");
}
console.log("Protected native auth storage: large Unicode sessions, verified migration, fault/restart recovery, logout, device-key loss, tamper/AAD, serialization and reinstall passed.");
