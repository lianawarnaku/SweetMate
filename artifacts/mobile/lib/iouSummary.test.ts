import assert from "node:assert/strict";
import { summarizeMemberIous, type SummaryExpense } from "./iouSummary.ts";

const reciprocal: SummaryExpense[] = [
  { paidBy: "a", splits: { b: 10 } },
  { paidBy: "b", splits: { a: 6 } },
];
const before = JSON.stringify(reciprocal);
assert.deepEqual(summarizeMemberIous(reciprocal, "a"), {
  owedCents: 1000, owingCents: 600, netCents: 400, hasOutstandingDebts: true,
});
assert.equal(JSON.stringify(reciprocal), before, "summary must never change repayment records");
const chain: SummaryExpense[] = [{ paidBy: "b", splits: { a: 10 } }, { paidBy: "c", splits: { b: 10 } }];
assert.deepEqual(summarizeMemberIous(chain, "b"), {
  owedCents: 1000, owingCents: 1000, netCents: 0, hasOutstandingDebts: true,
}, "a zero net position is not settled when individual debts remain");
assert.equal(summarizeMemberIous([{ paidBy: "a", splits: { b: 10 }, paidBack: { b: true } }], "a").hasOutstandingDebts, false);
assert.equal(summarizeMemberIous([{ paidBy: "a", splits: { b: 10 }, settled: true }], "a").netCents, 0);
assert.equal(summarizeMemberIous([{ paidBy: "a", splits: { a: 10, b: 0.1, c: 0.2 } }], "a").netCents, 30);
assert.equal(summarizeMemberIous([{ paidBy: "a", splits: { b: NaN, c: -10 } }], "a").hasOutstandingDebts, false);
assert.equal(summarizeMemberIous(chain, "unrelated").hasOutstandingDebts, false);
console.log("IOU summary tests passed");
