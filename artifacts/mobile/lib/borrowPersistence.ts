import type { BorrowItem } from "../context/AppContext";
import { supabase } from "./supabase";
import { rowToSharedBorrow, sharedBorrowToRow, type SharedBorrowRow } from "./sharedBorrowRow";
import { reportSupabaseError } from "./runtimeDiagnostics";

/** Do not dismiss the borrowing editor until the server acknowledges its row. */
export async function saveBorrowRecord(entry: BorrowItem): Promise<BorrowItem> {
  if (!entry.householdId || !entry.ownerId) throw new Error("Your household is still loading. Please try again.");
  const privateEntry = entry.visibility === "private";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const result = privateEntry
      ? await supabase.from("private_borrow_items").upsert({ id: entry.id, household_id: entry.householdId, owner_id: entry.ownerId, entry, updated_at: entry.updatedAt }, { onConflict: "id" }).select("*").abortSignal(controller.signal).single()
      : await supabase.from("shared_borrow_items").upsert(sharedBorrowToRow(entry, entry.householdId), { onConflict: "id" }).select("*").abortSignal(controller.signal).single();
    const { data, error } = result;
    if (error) {
      reportSupabaseError("save borrowing record", error, { householdId: entry.householdId });
      throw new Error(error.code === "42501"
        ? "You no longer have access to save this record. Reopen your household and try again."
        : "This borrowing record could not be saved. Check your connection and try again.");
    }
    if (!data || data.id !== entry.id || data.household_id !== entry.householdId ||
        (privateEntry && data.owner_id !== entry.ownerId)) throw new Error("The save could not be confirmed. Please try again.");
    return privateEntry
      ? { ...entry, updatedAt: data.updated_at }
      : rowToSharedBorrow(data as SharedBorrowRow);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Saving timed out. Check your connection and try again.");
    throw error;
  } finally { clearTimeout(timer); }
}
