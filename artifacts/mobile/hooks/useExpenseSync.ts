import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Expense } from "@/context/AppContext";
import { ExpenseSync, type ExpenseAction, type ExpenseMutationResult, type ExpenseSyncState } from "@/lib/expenseSync";
import { rowToExpense, type ExpenseRow } from "@/lib/expenseRow";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";

async function expenseRequest<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try { return await request(controller.signal); }
  finally { clearTimeout(timeout); }
}
const EMPTY_STATE: ExpenseSyncState = { ready: false, pending: 0, pendingIds: [], error: null };
export function useExpenseSync({ householdId, userId, cloudReady, entitiesRef, setEntities }: {
  householdId: string | null; userId?: string; cloudReady: boolean;
  entitiesRef: React.MutableRefObject<Expense[]>;
  setEntities: React.Dispatch<React.SetStateAction<Expense[]>>;
}) {
  const [state, setState] = useState(EMPTY_STATE);
  const readyRef = useRef(false);
  const engineRef = useRef<ExpenseSync | null>(null);
  const scopeRef = useRef("");
  const engineScopeRef = useRef("");
  const scope = cloudReady && userId && householdId ? `${userId}:${householdId}` : "";
  // Prevent a callback from the previous household from applying before effect cleanup.
  scopeRef.current = scope;
  readyRef.current = scope !== "" && state.ready && engineRef.current !== null && engineScopeRef.current === scope;
  useEffect(() => {
    setState(EMPTY_STATE);
    readyRef.current = false;
    if (!scope || !householdId || !userId) { engineRef.current = null; return; }
    const engine = new ExpenseSync({
      householdId, userId, storage: AsyncStorage, makeOperationId: () => Crypto.randomUUID(),
      fetch: async () => {
        const { data, error } = await expenseRequest(signal => supabase.from("expenses").select("*").eq("household_id", householdId).abortSignal(signal));
        if (error) throw error;
        return (data ?? []) as ExpenseRow[];
      },
      mutate: async operation => {
        const { data, error } = await expenseRequest(signal => supabase.rpc("mutate_expense", {
          p_household_id: householdId, p_operation_id: operation.operationId, p_action: operation.action,
          p_expense_id: operation.expenseId, p_payload: { ...operation.payload, _expectedActorId: userId }, p_expected_version: operation.expectedVersion,
        }).abortSignal(signal));
        if (error) throw error;
        return data as ExpenseMutationResult;
      },
      onRows: rows => {
        if (scopeRef.current !== scope) return;
        const next = rows.map(rowToExpense);
        entitiesRef.current = next;
        setEntities(next);
      },
      onState: next => { if (scopeRef.current === scope) { readyRef.current = next.ready; setState(next); } },
      onAcknowledged: (operation, result) => {
        if (scopeRef.current !== scope) return;
        if (operation.action === "create") track.expenseCreated({ recurring: false });
        if (operation.action === "settle") track.iouSettled({ source: "manual" });
        if (operation.action === "repay") {
          track.expenseRepaymentRecorded({ settles_expense: !!result.expense?.settled });
          if (result.expense?.settled) track.iouSettled({ source: "repayment" });
        }
      },
    });
    engineRef.current = engine;
    engineScopeRef.current = scope;
    const refresh = () => { void engine.retry().catch(error => { if (scopeRef.current === scope) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : "Expenses couldn’t refresh. Try again." })); }); };
    // Subscribe first; every (re)subscription reconciles full authoritative state.
    const channel = supabase.channel(`expense-commands:${householdId}:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses", filter: `household_id=eq.${householdId}` }, payload => engine.receive(payload.new as ExpenseRow))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses", filter: `household_id=eq.${householdId}` }, payload => engine.receive(payload.new as ExpenseRow))
      // Postgres Changes cannot filter DELETE events. With RLS their old row
      // contains only the primary key; IDs are globally unique and are never reused.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, payload => engine.receive(payload.old as ExpenseRow, true))
      .subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
    const foreground = AppState.addEventListener("change", status => { if (status === "active") refresh(); });
    const timer = setInterval(() => { if (engine.state.pending) refresh(); }, 30_000);
    refresh();
    return () => { engine.dispose(); if (engineRef.current === engine) engineRef.current = null; readyRef.current = false; foreground.remove(); clearInterval(timer); void supabase.removeChannel(channel); };
  }, [scope, householdId, userId, entitiesRef, setEntities]);
  const mutate = useCallback((action: ExpenseAction, id: string, payload: Record<string, unknown> = {}, version: number | null = null) => {
    const engine = engineRef.current;
    if (!scopeRef.current || !engine || engineScopeRef.current !== scopeRef.current) return Promise.reject(new Error("Your Sweet is still loading."));
    return engine.submit(action, id, payload, version);
  }, []);
  const retry = useCallback(async () => { await engineRef.current?.retry(); }, []);
  return { readyRef, mutate, pendingExpenseIds: state.pendingIds, expenseSync: { ready: !!scope && engineScopeRef.current === scope && state.ready, pending: state.pending, error: state.error, retry } };
}
