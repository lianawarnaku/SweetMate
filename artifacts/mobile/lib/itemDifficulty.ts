import {
  resolveItemDifficulty,
  type ItemCategory,
} from "@/constants/itemDifficulty";
import { supabase } from "@/lib/supabase";
import { reportSupabaseError } from "@/lib/runtimeDiagnostics";

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export async function getItemDifficulty(
  householdId: string,
  category: ItemCategory,
  item: string,
): Promise<Difficulty> {
  const { data, error } = await supabase
    .from("item_difficulty")
    .select("difficulty")
    .eq("household_id", householdId)
    .eq("category", category)
    .eq("item", item)
    .maybeSingle();
  if (error) {
    reportSupabaseError("load item difficulty", error, {
      householdId,
      category,
      item,
    });
  }
  if (data?.difficulty && data.difficulty >= 1 && data.difficulty <= 5) {
    return data.difficulty as Difficulty;
  }
  return resolveItemDifficulty(category, item);
}
