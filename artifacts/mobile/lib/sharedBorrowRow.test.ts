import type { BorrowItem } from "../context/AppContext.ts";
import { rowToSharedBorrow, sharedBorrowToRow } from "./sharedBorrowRow.ts";
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const item: BorrowItem = { id: "borrow-1", householdId: "home-1", creatorId: "user-1", ownerId: "user-1",
  visibility: "shared", item: "Vacuum", borrowedFrom: "user-1", borrowedBy: "user-2",
  borrowedAt: "2026-08-27T10:00:00.000Z", dueDate: "2026-08-30T10:00:00.000Z",
  returned: false, notes: "Handle carefully", createdAt: "2026-08-27T10:00:00.000Z", updatedAt: "2026-08-27T10:00:00.000Z" };
const row = sharedBorrowToRow(item, "home-1");
assert(JSON.stringify(rowToSharedBorrow(row)) === JSON.stringify(item), "shared borrow rows must round-trip losslessly");
assert(row.borrowed_by === "user-2" && row.owner_id === "user-1", "borrow participants must be constrained columns");
assert(row.entry.visibility === "shared", "normalized shared rows must never become private records");
console.log("shared borrow normalized row tests passed");
