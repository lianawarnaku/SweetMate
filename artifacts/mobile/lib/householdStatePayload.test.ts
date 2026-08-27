import { withoutNormalizedCollections } from "./householdStatePayload.ts";
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const payload = withoutNormalizedCollections({ chores: [1], expenses: [2], shoppingLists: [3], shoppingItems: [4], shoppingSyncMeta: {}, borrowItems: [5], roommates: [6], homeProfile: { housingType: "suite" } });
assert(!("chores" in payload) && !("expenses" in payload) && !("borrowItems" in payload), "normalized entity collections must leave the blob payload");
assert(!("shoppingLists" in payload) && !("shoppingItems" in payload) && !("shoppingSyncMeta" in payload), "all shopping persistence fields must leave the blob payload");
assert("roommates" in payload && "homeProfile" in payload, "unmigrated household-global state must remain intact");
console.log("household state payload cleanup tests passed");
