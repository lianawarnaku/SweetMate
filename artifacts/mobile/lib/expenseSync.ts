import type { ExpenseRow } from "./expenseRow.ts";

export type ExpenseAction = "create" | "update" | "repay" | "settle" | "delete" | "reopen" | "undo_repay" | "restore";
export type ExpenseOperation = {
  operationId: string;
  action: ExpenseAction;
  expenseId: string;
  payload: Record<string, unknown>;
  expectedVersion: number | null;
  createdAt?: string;
};
export type ExpenseMutationResult = { expense: ExpenseRow | null; deleted: boolean; id: string };
export type ExpenseRequestSummary = ExpenseOperation & {
  title: string;
  amountCents?: number;
  status: "pending" | "failed";
  error?: string;
  createdAt: string;
};
type FailedExpenseOperation = ExpenseOperation & { error: string; failedAt: string };
export type ExpenseSyncState = {
  ready: boolean; pending: number; pendingIds: string[]; error: string | null;
  refreshing: boolean; lastSyncedAt: string | null; stale: boolean;
  requests: ExpenseRequestSummary[];
};
function jsonCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export class ExpensePendingError extends Error {
  constructor() { super("Saved on this device, but not sent yet. Use Retry in Expenses when you’re connected. Don’t enter it again."); }
}
export function isRetryableExpenseError(error: unknown): boolean {
  const value = error as { code?: string; status?: number; message?: string };
  const code = typeof value?.code === "string" ? value.code : "";
  if (code && /^(22|23|28|42|P0)/.test(code)) return false;
  if (code === "PGRST202") return false;
  return !code || code.startsWith("08") || code === "57014" || (value?.status ?? 0) >= 500;
}
function errorMessage(error: unknown): string {
  const value = error as { message?: string; code?: string };
  if (value?.code === "PGRST202") return "The Expenses update is not available on the server yet. Please try again after the update is deployed.";
  return value?.message || "Unable to save this expense. Please try again.";
}

type ExpenseSyncOptions = {
    householdId: string; userId: string; storage: Storage; makeOperationId(): string;
    fetch(): Promise<ExpenseRow[]>;
    mutate(operation: ExpenseOperation): Promise<ExpenseMutationResult>;
    onRows(rows: ExpenseRow[]): void;
    onState(state: ExpenseSyncState): void;
    onAcknowledged?(operation: ExpenseOperation, result: ExpenseMutationResult): void;
};

/** Explicit commands only: a missing row in a cache/snapshot never issues a DELETE.
 * Financial data stays authoritative until the server acknowledges a mutation.
 * Persisting before RPC and replaying the same operation ID makes lost responses safe.
 */
export class ExpenseSync {
  private operations: ExpenseOperation[] = [];
  private failedOperations: FailedExpenseOperation[] = [];
  private refreshing = false;
  private lastSyncedAt: string | null = null;
  private stale = true;
  private rows = new Map<string, ExpenseRow>();
  private changes = new Map<string, { sequence: number; row: ExpenseRow | null }>();
  private sequence = 0;
  private deletedIds = new Set<string>();
  private active = true;
  private initialized = false;
  private ready = false;
  private error: string | null = null;
  private rejection: string | null = null;
  private work: Promise<unknown> = Promise.resolve();
  private refreshNumber = 0;
  private outcomes = new Map<string, ExpenseMutationResult | Error>();
  private options: ExpenseSyncOptions;
  constructor(options: ExpenseSyncOptions) { this.options = options; }
  get storageKey() { return `sweetmate:expenses:outbox:v1:${this.options.userId}:${this.options.householdId}`; }
  get state(): ExpenseSyncState {
    const summary = (op: ExpenseOperation, status: "pending" | "failed", error?: string): ExpenseRequestSummary => ({
      ...op, payload: jsonCopy(op.payload), status, error,
      title: typeof op.payload.title === "string" ? op.payload.title : this.rows.get(op.expenseId)?.entry.title ?? "Expense",
      amountCents: typeof op.payload.amountCents === "number" ? op.payload.amountCents
        : op.action === "undo_repay" ? this.rows.get(op.expenseId)?.entry.repayments?.find(payment => payment.id === op.payload.paymentId)?.amountCents
        : op.action === "repay" ? undefined : this.rows.get(op.expenseId)?.amount_cents,
      createdAt: op.createdAt ?? "",
    });
    return { ready: this.ready, pending: this.operations.length, pendingIds: [...new Set(this.operations.map(op => op.expenseId))], error: this.error,
      refreshing: this.refreshing, lastSyncedAt: this.lastSyncedAt, stale: this.stale,
      requests: [...this.operations.map(op => summary(op, "pending")), ...this.failedOperations.map(op => summary(op, "failed", op.error))],
    };
  }
  private publish() {
    if (!this.active) return;
    this.options.onState(this.state);
    if (this.ready) this.options.onRows([...this.rows.values()]);
  }
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const result = this.work.then(job, job);
    this.work = result.catch(() => {});
    return result;
  }
  private async persist() {
    await this.options.storage.setItem(this.storageKey, JSON.stringify({ version: 1, operations: this.operations, failedOperations: this.failedOperations, rejection: this.rejection }));
  }
  async initialize() {
    await this.serial(async () => {
      if (!this.active || this.initialized) return;
      const raw = await this.options.storage.getItem(this.storageKey);
      if (!this.active) return;
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored.version !== 1 || !Array.isArray(stored.operations) || stored.operations.some((op: ExpenseOperation) =>
          !op || typeof op.operationId !== "string" || typeof op.expenseId !== "string" || !["create", "update", "repay", "settle", "delete", "reopen", "undo_repay", "restore"].includes(op.action) || !op.payload || typeof op.payload !== "object"
        )) throw new Error("Your saved expense requests could not be read. They have been kept on this device.");
        this.operations = stored.operations;
        if (stored.failedOperations !== undefined && (!Array.isArray(stored.failedOperations) || stored.failedOperations.some((op: FailedExpenseOperation) =>
          !op || typeof op.operationId !== "string" || typeof op.expenseId !== "string" || typeof op.error !== "string" || !op.payload || typeof op.payload !== "object"
        ))) throw new Error("Your saved expense drafts could not be read. They have been kept on this device.");
        this.failedOperations = stored.failedOperations ?? [];
        this.rejection = typeof stored.rejection === "string" ? stored.rejection : null;
        this.error = this.rejection;
      }
      this.initialized = true;
      this.publish();
    });
    if (!this.active) return;
    await this.retry();
  }
  async refresh() {
    if (!this.active || !this.initialized) return;
    const refresh = ++this.refreshNumber;
    const atSequence = this.sequence;
    this.refreshing = true;
    this.publish();
    try {
      const incoming = await this.options.fetch();
      if (!this.active || refresh !== this.refreshNumber) return;
      const next = new Map(incoming.filter(row => row.household_id === this.options.householdId && !this.deletedIds.has(row.id)).map(row => [row.id, row]));
      // Events/acknowledgements delivered while SELECT was in flight win over its snapshot.
      for (const [id, change] of this.changes) {
        if (change.sequence <= atSequence) continue;
        if (change.row) next.set(id, change.row); else next.delete(id);
      }
      this.rows = next;
      this.ready = true;
      this.stale = false;
      this.lastSyncedAt = new Date().toISOString();
      if (!this.operations.length) this.error = this.rejection;
      this.publish();
    } catch (error) {
      if (this.active && refresh === this.refreshNumber) { this.stale = true; this.error = `Expenses couldn’t refresh. ${errorMessage(error)}`; this.publish(); }
    } finally {
      if (this.active && refresh === this.refreshNumber) { this.refreshing = false; this.publish(); }
    }
  }
  receive(row: ExpenseRow | { id: string; household_id?: string }, deleted = false) {
    if (!this.active || (row.household_id && row.household_id !== this.options.householdId)) return;
    if (!deleted && this.deletedIds.has(row.id)) return;
    if (deleted) this.deletedIds.add(row.id);
    const current = this.rows.get(row.id);
    if (!deleted && current && (current.version ?? 0) > ((row as ExpenseRow).version ?? 0)) return;
    const next = deleted ? null : row as ExpenseRow;
    this.changes.set(row.id, { sequence: ++this.sequence, row: next });
    if (next) this.rows.set(row.id, next); else this.rows.delete(row.id);
    this.publish();
  }
  async submit(action: ExpenseAction, expenseId: string, payload: Record<string, unknown> = {}, expectedVersion: number | null = null): Promise<ExpenseMutationResult> {
    return this.serial(async () => {
      if (!this.active) throw new Error("Your Sweet changed. Open the expense again.");
      if (!this.initialized || !this.ready) throw new Error("Expenses are still loading. Please try again when they finish.");
      const matching = this.operations.find(op => op.action === action &&
        (op.expenseId === expenseId && JSON.stringify(op.payload) === JSON.stringify(payload)));
      if (!matching && this.operations.some(op => op.expenseId === expenseId)) throw new Error("This expense already has a request waiting to sync. Retry that request first.");
      const operation = matching ?? { operationId: this.options.makeOperationId(), action, expenseId, payload: jsonCopy(payload), expectedVersion, createdAt: new Date().toISOString() };
      if (!matching) {
        this.rejection = this.failedOperations.at(-1)?.error ?? null;
        this.operations.push(operation);
        try { await this.persist(); }
        catch { this.operations = this.operations.filter(op => op !== operation); throw new Error("This request couldn’t be saved on your device. Please try again."); }
      }
      this.error = null;
      this.publish();
      await this.flush();
      if (!this.active) throw new Error("Your Sweet changed. Your saved request will be checked when you return.");
      const outcome = this.outcomes.get(operation.operationId);
      this.outcomes.delete(operation.operationId);
      if (outcome instanceof Error) throw outcome;
      if (outcome) return outcome;
      throw new ExpensePendingError();
    });
  }
  private async flush() {
    if (!this.active || !this.initialized || !this.ready) return;
    let acknowledged = false;
    for (const operation of [...this.operations]) {
      if (!this.active) return;
      try {
        const result = await this.options.mutate(operation);
        if (!this.active) return; // Keep durable intent for idempotent replay after a household switch.
        if (!result || result.id !== operation.expenseId || (!result.deleted && (!result.expense || result.expense.household_id !== this.options.householdId))) throw new Error("The server response could not be verified. Retry to check the saved request.");
        if (result.deleted) this.receive({ id: result.id, household_id: this.options.householdId }, true);
        else if (result.expense) this.receive(result.expense);
        const before = this.operations;
        const previousFailed = this.failedOperations;
        const previousRejection = this.rejection;
        this.operations = this.operations.filter(op => op.operationId !== operation.operationId);
        this.failedOperations = this.failedOperations.filter(op => op.expenseId !== operation.expenseId || op.action !== operation.action);
        this.rejection = this.failedOperations.at(-1)?.error ?? null;
        try { await this.persist(); }
        catch (error) { this.operations = before; this.failedOperations = previousFailed; this.rejection = previousRejection; throw error; } // Keep receipt replayable if local acknowledgement fails.
        if (!this.active) return;
        this.outcomes.set(operation.operationId, result);
        if (this.outcomes.size > 100) this.outcomes.delete(this.outcomes.keys().next().value!);
        acknowledged = true;
        this.options.onAcknowledged?.(operation, result);
      } catch (error) {
        if (!this.active) return;
        if (isRetryableExpenseError(error)) {
          this.error = "A request is saved on this device and waiting to sync. Check your connection, then Retry.";
          this.publish();
          return;
        }
        const rejection = new Error(errorMessage(error));
        const before = this.operations;
        const previousFailed = this.failedOperations;
        this.failedOperations = [...this.failedOperations.filter(op => op.operationId !== operation.operationId), { ...operation, error: rejection.message, failedAt: new Date().toISOString() }];
        this.rejection = rejection.message;
        this.operations = this.operations.filter(op => op.operationId !== operation.operationId);
        try { await this.persist(); }
        catch { this.operations = before; this.failedOperations = previousFailed; this.error = "The server rejected a request, but its local status couldn’t be saved. Retry to check it again."; this.publish(); return; }
        this.outcomes.set(operation.operationId, rejection);
        this.error = rejection.message;
        // A denied/stale command must not block independent expenses behind it.
      }
    }
    this.publish();
    // Receipts are idempotent, but another device may have changed the row
    // since the command committed. Reconcile again after replaying them.
    if (this.active && acknowledged) await this.refresh();
  }
  async retry() {
    if (!this.initialized) return this.initialize();
    await this.refresh();
    await this.serial(async () => { if (this.ready) { this.error = this.rejection; await this.flush(); } this.publish(); });
  }
  failedOperation(operationId: string): ExpenseOperation | null {
    const operation = this.failedOperations.find(op => op.operationId === operationId);
    if (!operation) return null;
    if (this.operations.some(op => op.expenseId === operation.expenseId)) throw new Error("This expense still has a request waiting to sync. Check it before recovering a draft.");
    return jsonCopy(operation);
  }
  currentExpense(id: string) { const value = this.rows.get(id); return value ? jsonCopy(value) : null; }
  async dismissFailed(operationId: string) {
    await this.serial(async () => {
      if (!this.active) throw new Error("Your Sweet changed. Open Expenses again.");
      if (this.operations.some(op => op.operationId === operationId)) throw new Error("This request may already have reached the server. Retry it to confirm its outcome before making another change.");
      const before = this.failedOperations;
      this.failedOperations = this.failedOperations.filter(op => op.operationId !== operationId);
      const previousRejection = this.rejection;
      this.rejection = this.failedOperations.at(-1)?.error ?? null;
      try { await this.persist(); } catch (error) { this.failedOperations = before; this.rejection = previousRejection; throw error; }
      this.error = this.rejection;
      this.publish();
    });
  }
  connectionLost() {
    if (!this.active) return;
    this.stale = true;
    this.error = this.error ?? "Couldn’t connect. Balances show the last saved update.";
    this.publish();
  }
  dispose() { this.active = false; ++this.refreshNumber; }
}
