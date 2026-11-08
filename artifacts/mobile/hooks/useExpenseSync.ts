import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Expense, ExpenseActivity, RecoveredExpenseDraft } from "@/context/AppContext";
import { ExpenseSync, type ExpenseAction, type ExpenseMutationResult, type ExpenseSyncState, type ExpenseRequestSummary } from "@/lib/expenseSync";
import { canEditExpense, expenseFinancialSignature, hasExpensePayments } from "@/lib/expensePolicy";
import { rowToExpense, type ExpenseRow } from "@/lib/expenseRow";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";

async function expenseRequest<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try { return await request(controller.signal); }
  finally { clearTimeout(timeout); }
}
export type ExpenseSyncStatus = {
  ready: boolean; pending: number; error: string | null; retry: () => Promise<void>;
  refreshing: boolean; lastSyncedAt: string | null; stale: boolean;
  requests: ExpenseRequestSummary[];
  recover: (operationId: string) => Promise<RecoveredExpenseDraft | null>;
  dismissFailed: (operationId: string) => Promise<void>;
};
const EMPTY_STATE: ExpenseSyncState = { ready: false, pending: 0, pendingIds: [], error: null, refreshing: false, lastSyncedAt: null, stale: true, requests: [] };
type ActivityRow = { id: string; expense_id: string; actor_id: string | null; action: string; summary: string; created_at: string; amount_cents: number | null; payment_id: string | null };
function mapActivity(row: ActivityRow): ExpenseActivity {
  return { id: row.id, expenseId: row.expense_id, actorId: row.actor_id, action: row.action, summary: row.summary, createdAt: row.created_at,
    ...(row.amount_cents == null ? {} : { amountCents: row.amount_cents }), ...(row.payment_id ? { paymentId: row.payment_id } : {}) };
}
function mergeActivity(previous: ExpenseActivity[], incoming: ExpenseActivity[]) {
  const rows = new Map(previous.map(row => [row.id, row]));
  incoming.forEach(row => rows.set(row.id, row));
  return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export function useExpenseSync({ householdId, userId, cloudReady, entitiesRef, setEntities }: {
  householdId: string | null; userId?: string; cloudReady: boolean;
  entitiesRef: React.MutableRefObject<Expense[]>;
  setEntities: React.Dispatch<React.SetStateAction<Expense[]>>;
}) {
  const [state, setState] = useState(EMPTY_STATE);
  const [expenseActivity, setExpenseActivity] = useState<ExpenseActivity[]>([]);
  const [expenseActivityLoading, setExpenseActivityLoading] = useState(false);
  const [expenseActivityError, setExpenseActivityError] = useState<string | null>(null);
  const activityLoaderRef = useRef<(expenseId?: string) => Promise<void>>(async () => {});
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
    setExpenseActivity([]);
    setExpenseActivityError(null);
    setExpenseActivityLoading(false);
    activityLoaderRef.current = async () => {};
    readyRef.current = false;
    if (!scope || !householdId || !userId) { engineRef.current = null; return; }
    let effectActive = true;
    let activityQueries = 0;
    const loadActivity = async (expenseId?: string) => {
      if (!effectActive || scopeRef.current !== scope) return;
      ++activityQueries;
      setExpenseActivityLoading(true);
      try {
        let query = supabase.from("expense_activity").select("*").eq("household_id", householdId);
        if (expenseId) query = query.eq("expense_id", expenseId);
        const { data, error } = await expenseRequest(signal => query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200).abortSignal(signal));
        if (!effectActive || scopeRef.current !== scope) return;
        if (error) throw error;
        setExpenseActivity(previous => mergeActivity(previous, ((data ?? []) as ActivityRow[]).map(mapActivity)));
        setExpenseActivityError(null);
      } catch (error) {
        if (effectActive && scopeRef.current === scope) setExpenseActivityError("Recent expense activity couldn’t load. Please try again.");
        throw error;
      } finally {
        --activityQueries;
        if (effectActive && scopeRef.current === scope) setExpenseActivityLoading(activityQueries > 0);
      }
    };
    activityLoaderRef.current = loadActivity;
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
          p_expense_id: operation.expenseId, p_payload: { ...operation.payload, _expectedActorId: userId,
            ...((operation.action === "repay" && operation.payload.amountCents === undefined) || (operation.action === "undo_repay" && operation.payload.paymentId === undefined) ? { _receiptOnly: true } : {}) }, p_expected_version: operation.expectedVersion,
        }).abortSignal(signal));
        if (error) throw error;
        return data as ExpenseMutationResult;
      },
      onRows: rows => {
        if (!effectActive || scopeRef.current !== scope) return;
        const next = rows.map(rowToExpense);
        entitiesRef.current = next;
        setEntities(next);
      },
      onState: next => { if (scopeRef.current === scope) { readyRef.current = next.ready; setState(next); } },
      onAcknowledged: (operation, result) => {
        if (!effectActive || scopeRef.current !== scope) return;
        void loadActivity().catch(() => {});
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
    const refresh = () => { void loadActivity().catch(() => {}); void engine.retry().catch(error => { if (scopeRef.current === scope) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : "Expenses couldn’t refresh. Try again." })); }); };
    // Subscribe first; every (re)subscription reconciles full authoritative state.
    const channel = supabase.channel(`expense-commands:${householdId}:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses", filter: `household_id=eq.${householdId}` }, payload => engine.receive(payload.new as ExpenseRow))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses", filter: `household_id=eq.${householdId}` }, payload => engine.receive(payload.new as ExpenseRow))
      // Postgres Changes cannot filter DELETE events. With RLS their old row
      // contains only the primary key; IDs are globally unique and are never reused.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, payload => engine.receive(payload.old as ExpenseRow, true))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "expense_activity", filter: `household_id=eq.${householdId}` }, payload => {
        if (effectActive && scopeRef.current === scope) setExpenseActivity(previous => mergeActivity(previous, [mapActivity(payload.new as ActivityRow)]));
      })
      .subscribe(status => { if (status === "SUBSCRIBED") refresh(); else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") engine.connectionLost(); });
    const foreground = AppState.addEventListener("change", status => { if (status === "active") refresh(); });
    const timer = setInterval(() => { if (engine.state.pending) refresh(); }, 30_000);
    refresh();
    return () => { effectActive = false; engine.dispose(); if (engineRef.current === engine) engineRef.current = null; readyRef.current = false; foreground.remove(); clearInterval(timer); void supabase.removeChannel(channel); };
  }, [scope, householdId, userId, entitiesRef, setEntities]);
  const mutate = useCallback((action: ExpenseAction, id: string, payload: Record<string, unknown> = {}, version: number | null = null) => {
    const engine = engineRef.current;
    if (!scope || scopeRef.current !== scope || !engine || engineScopeRef.current !== scope) return Promise.reject(new Error("Your Sweet is still loading."));
    return engine.submit(action, id, payload, version);
  }, [scope]);
  const retry = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !scope || scopeRef.current !== scope || engineScopeRef.current !== scope) return;
    await Promise.all([engine.retry(), activityLoaderRef.current().catch(() => {})]);
  }, [scope]);
  const loadExpenseActivity = useCallback(async (expenseId?: string) => { if (scope && scopeRef.current === scope) await activityLoaderRef.current(expenseId); }, [scope]);
  const recover = useCallback(async (operationId: string): Promise<RecoveredExpenseDraft | null> => {
    const engine = engineRef.current;
    if (!engine || !scope || scopeRef.current !== scope || engineScopeRef.current !== scope) throw new Error("Your Sweet is still loading.");
    await engine.refresh();
    if (engine !== engineRef.current || engineScopeRef.current !== scopeRef.current) throw new Error("Your Sweet changed. Open Expenses again.");
    if (!engine.state.ready || engine.state.stale) throw new Error("Connect to refresh Expenses before recovering this draft.");
    const operation = engine.failedOperation(operationId);
    if (!operation) return null;
    if (operation.action !== "create" && operation.action !== "update") throw new Error("Review this expense’s current details before trying the action again.");
    const row = engine.currentExpense(operation.expenseId);
    if (operation.action === "create") {
      if (row) throw new Error("This expense is already saved. Open its details instead of creating it again.");
      return { operationId, action: "create", expenseId: operation.expenseId, expense: { ...Object.fromEntries(Object.entries(operation.payload).filter(([key]) => ["title", "category", "notes", "amount", "amountCents", "paidBy", "sharedWith", "splits", "allocations", "splitMode", "date", "shoppingSource", "recurring", "recurringCustom"].includes(key))), id: operation.expenseId, creatorId: userId, settled: false, paidBack: {}, repaymentCents: {}, repayments: [], financialHistory: false, manuallySettled: false } as unknown as Expense };
    }
    if (!row) throw new Error("This expense is no longer available. Your saved draft is still on this device.");
    const current = rowToExpense(row);
    if (current.voidedAt) throw new Error("Restore this voided expense before recovering an edit.");
    if (!userId || !canEditExpense(current, userId)) throw new Error("Only the expense creator can recover an edit.");
    const editable = Object.fromEntries(Object.entries(operation.payload).filter(([key]) => ["title", "category", "notes", "amount", "amountCents", "paidBy", "sharedWith", "splits", "allocations", "splitMode", "date"].includes(key)));
    let expense = { ...current, ...editable } as Expense;
    let warning: string | undefined;
    if (hasExpensePayments(current) && expenseFinancialSignature(expense) !== expenseFinancialSignature(current)) {
      expense = { ...current, title: typeof operation.payload.title === "string" ? operation.payload.title : current.title,
        category: (operation.payload.category ?? current.category) as Expense["category"], notes: typeof operation.payload.notes === "string" ? operation.payload.notes : current.notes };
      warning = "Payment details changed while this request was waiting. Only the saved title, category, and notes were recovered.";
    }
    return { operationId, action: "update", expenseId: operation.expenseId, expense, ...(warning ? { warning } : {}) };
  }, [scope, userId]);
  const dismissFailed = useCallback(async (operationId: string) => {
    const engine = engineRef.current;
    if (!engine || !scope || scopeRef.current !== scope || engineScopeRef.current !== scope) throw new Error("Your Sweet is still loading.");
    await engine.dismissFailed(operationId);
  }, [scope]);
  const inScope = !!scope && engineScopeRef.current === scope;
  return { readyRef, mutate, pendingExpenseIds: inScope ? state.pendingIds : [],
    expenseActivity: inScope ? expenseActivity : [], expenseActivityLoading: inScope && expenseActivityLoading,
    expenseActivityError: inScope ? expenseActivityError : null, loadExpenseActivity,
    expenseSync: { ready: inScope && state.ready, pending: inScope ? state.pending : 0, error: inScope ? state.error : null, retry,
      refreshing: inScope && state.refreshing, lastSyncedAt: inScope ? state.lastSyncedAt : null,
      stale: !inScope || state.stale, requests: inScope ? state.requests : [], recover, dismissFailed } };
}
