import {
  allocationsToDollarSplits,
  buildEvenSplitCents,
  buildStoredExpenseAllocations,
  parseAllocationToCents,
  storedExpenseAllocationIsValid,
  validateExpenseAllocation,
} from "./money.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "./shoppingExpense.test.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const members = new Set(["payer", "a", "b"]);
const twoPerson = validateExpenseAllocation({
  total: "10.00",
  payerId: "payer",
  participantIds: ["payer", "a"],
  allocations: { payer: "4.25", a: "5.75" },
  activeMemberIds: members,
});
assert(twoPerson.valid, "two-person uneven exact allocation must validate");

const threePerson = validateExpenseAllocation({
  total: "10.00",
  payerId: "payer",
  participantIds: ["payer", "a", "b"],
  allocations: { payer: "3.33", a: "3.33", b: "3.34" },
  activeMemberIds: members,
});
assert(threePerson.valid, "three-person uneven exact allocation must validate");

const thirds = buildEvenSplitCents(1000, ["payer", "a", "b"]);
assert(
  thirds.payer === 334 && thirds.a === 333 && thirds.b === 333,
  "$10 split three ways must assign the cent remainder deterministically",
);
assert(
  Object.values(thirds).reduce((sum, cents) => sum + cents, 0) === 1000,
  "rounded even allocations must preserve the total",
);

assert(parseAllocationToCents("-1.00") === null, "negative allocations must be rejected");
assert(
  !validateExpenseAllocation({
    total: "bad",
    payerId: "payer",
    participantIds: ["a"],
    allocations: { a: "1.00" },
    activeMemberIds: members,
  }).valid,
  "invalid totals must be rejected",
);
assert(
  !validateExpenseAllocation({
    total: "1.00",
    payerId: "payer",
    participantIds: ["outside"],
    allocations: { outside: "1.00" },
    activeMemberIds: members,
  }).valid,
  "participants outside the household must be rejected",
);
assert(
  !validateExpenseAllocation({
    total: "1.00",
    payerId: "payer",
    participantIds: ["a", "a"],
    allocations: { a: "1.00" },
    activeMemberIds: members,
  }).valid,
  "duplicate participants must be rejected",
);

if (!threePerson.valid) throw new Error("expected valid allocation");
const stored = buildStoredExpenseAllocations(
  ["payer", "a", "b"],
  threePerson.allocationCents,
);
assert(
  storedExpenseAllocationIsValid(1000, ["payer", "a", "b"], stored, members),
  "structured cent allocations must survive persistence validation",
);
assert(
  JSON.stringify(allocationsToDollarSplits(stored)) ===
    JSON.stringify({ payer: 3.33, a: 3.33, b: 3.34 }),
  "legacy dollar splits must be deterministically derived from cent allocations",
);

const expenseScreen = readFileSync(
  resolve(process.cwd(), "app/(tabs)/expenses.tsx"),
  "utf8",
);
assert(
  expenseScreen.includes('label: "Custom amounts"') &&
    expenseScreen.includes("buildStoredExpenseAllocations") &&
    expenseScreen.includes("amountCents: allocationValidation.totalCents"),
  "Custom IOU must expose and persist structured exact-cent allocations",
);
// Save deduplication, acknowledgement and captured edit versions are exercised
// with the actual callbacks in expenseUi.test.ts and expenseMutations.test.ts.
