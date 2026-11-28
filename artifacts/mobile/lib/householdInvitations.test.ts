import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const exports: any = {};
runInNewContext(
  ts.transpileModule(readFileSync("lib/householdInvitations.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  {
    exports,
    Error,
    require: (name: string) => {
      assert.equal(name, "expo-crypto");
      return {
        CryptoDigestAlgorithm: { SHA256: "SHA256" },
        digestStringAsync: async (_algorithm: string, value: string) =>
          createHash("sha256").update(value).digest("hex"),
      };
    },
  },
);
assert.equal(exports.normalizeInvitation(" abcd-1234 "), "ABCD1234");
assert.equal(
  await exports.invitationDigest("abcdef-123456"),
  createHash("sha256").update("ABCDEF123456").digest("hex"),
);
await assert.rejects(exports.invitationDigest("short"));
assert.equal(
  exports.joinedHousehold({
    ok: true,
    household_id: "12345678-1234-1234-1234-123456789abc",
  }),
  "12345678-1234-1234-1234-123456789abc",
);
assert.throws(
  () => exports.joinedHousehold({ ok: false, message: "Ask the host" }),
  /Ask the host/,
);
assert.throws(() => exports.joinedHousehold(null));
assert.throws(() =>
  exports.joinedHousehold({
    ok: true,
    household_id: "------------------------------------",
  }),
);
const context = readFileSync("context/AppContext.tsx", "utf8"),
  transport = readFileSync("lib/durableMutationFetch.ts", "utf8"),
  sql = readFileSync(
    "../../supabase/migrations/202611270002_household_invitation_controls.sql",
    "utf8",
  );
assert(context.includes('supabase.rpc("redeem_household_invite"'));
assert(context.includes("invitation_hash: invitationHash"));
assert(context.includes("joinedHousehold(data)"));
assert(context.includes("setInviteCode(issuedCode)"));
assert(transport.includes('"get_household_invitations"'));
assert(transport.includes('"create_household_reinvitation"'));
assert(sql.includes("_household_invitation_budget"));
assert(sql.includes("removal_version"));
console.log(
  "Invitation normalization/hash-only admission, denial validation, server code handling and endpoint coverage passed",
);
