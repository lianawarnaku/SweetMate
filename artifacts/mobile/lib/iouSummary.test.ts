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
assert.deepEqual(summarizeMemberIous([{
  paidBy: "a", splits: { b: 1000000 }, allocations: [{ participantId: "b", amountCents: 601 }],
}], "b"), { owedCents: 0, owingCents: 601, netCents: -601, hasOutstandingDebts: true }, "canonical cent allocations override conflicting legacy dollar fields");
assert.equal(summarizeMemberIous([{
  paidBy: "a", splits: { b: 100 }, allocations: [{ participantId: "b", amountCents: 0 }],
}], "b").hasOutstandingDebts, false, "zero-cent allocations do not create debt");
assert.equal(summarizeMemberIous([{
  paidBy: "a", allocations: [{ participantId: "b", amountCents: 601 }, { participantId: "b", amountCents: 601 }],
}], "a").owedCents, 601, "a malformed duplicate participant cannot double a debt");
assert.equal(summarizeMemberIous([{
  paidBy: "a", allocations: [{ participantId: "b", amountCents: 1.5 }, { participantId: "c", amountCents: NaN }],
}], "a").hasOutstandingDebts, false, "invalid cent allocations do not poison the summary");
console.log("IOU summary tests passed");

const partlyRepaid: SummaryExpense[] = [
  { paidBy: "a", allocations: [{ participantId: "a", amountCents: 400 }, { participantId: "b", amountCents: 601 }, { participantId: "c", amountCents: 0 }], repaymentCents: { b: 200 }, paidBack: { b: true } },
  { paidBy: "b", allocations: [{ participantId: "a", amountCents: 501 }], repaymentCents: { a: 100 } },
];
assert.deepEqual(summarizeMemberIous(partlyRepaid, "a"), {
  owedCents: 401, owingCents: 401, netCents: 0, hasOutstandingDebts: true,
}, "partial debts can offset without being repaid or silently net-settled");
assert.deepEqual(summarizeMemberIous(partlyRepaid, "b"), {
  owedCents: 401, owingCents: 401, netCents: 0, hasOutstandingDebts: true,
});
const beforePartialSummary = JSON.stringify(partlyRepaid);
summarizeMemberIous(partlyRepaid, "a");
assert.equal(JSON.stringify(partlyRepaid), beforePartialSummary, "summaries never rewrite repayment history");
assert.equal(summarizeMemberIous([{ ...partlyRepaid[0], voidedAt: "2026-11-09T12:00:00Z" }], "a").owedCents, 0);
assert.equal(summarizeMemberIous([{ ...partlyRepaid[0], settled: true, manuallySettled: true }], "a").owedCents, 0);
assert.equal(summarizeMemberIous([{ ...partlyRepaid[0], repaymentCents: {} }], "a").owedCents, 601, "an authoritative empty cent map supersedes old full-payment flags");
assert.equal(summarizeMemberIous([{ ...partlyRepaid[0], repaymentCents: { b: 601 }, paidBack: {} }], "a").hasOutstandingDebts, false);
assert.equal(summarizeMemberIous([{ ...partlyRepaid[0], repaymentCents: { b: 0 }, repayments: [{ reversedAt: "2026-11-09T12:00:00Z" }] }], "a").owedCents, 601, "reversed repayment cents restore the outstanding balance");
console.log("IOU partial repayment and void summaries passed");
