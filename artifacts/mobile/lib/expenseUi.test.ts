import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { allocationsToDollarSplits, buildStoredExpenseAllocations, centsToDollars } from "./money.ts";
import { ExpensePendingError } from "./expenseSync.ts";

// These execute the screen's real callbacks with controlled state and writes.
// They verify state transitions and native-modal wiring, not iPhone presentation or pixels.
const source = readFileSync(resolve(process.cwd(), "app/(tabs)/expenses.tsx"), "utf8");
const parsed = ts.createSourceFile("expenses.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map<string, ts.Expression>();
let detailsModal: ts.JsxElement | undefined;
let beginEdit: ts.Expression | undefined;
function attributeExpression(attributes: ts.JsxAttributes, name: string): ts.Expression | undefined {
  const attribute = attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(parsed) === name);
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
}
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const initializer = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === "useCallback"
      ? node.initializer.arguments[0] : node.initializer;
    if (initializer) initializers.set(node.name.text, initializer);
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "Modal" && attributeExpression(node.openingElement.attributes, "visible")?.getText(parsed) === "detailVisible") detailsModal = node;
  if (ts.isJsxOpeningElement(node)) {
    const onPress = attributeExpression(node.attributes, "onPress");
    if (onPress?.getText(parsed).includes("pendingEditRef.current = detailExp")) beginEdit = onPress;
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
const callbackNames = ["openDetails", "closeDetails", "finishDetailDismiss", "requestExpenseAction", "performExpenseAction"] as const;
for (const name of callbackNames) assert(initializers.has(name), `the real ${name} callback must exist`);
assert(beginEdit, "the real Details Edit handler must exist");
const actualBeginEdit = beginEdit;
assert(detailsModal, "Details must use its controlled native modal");
assert.equal(attributeExpression(detailsModal.openingElement.attributes, "onDismiss")?.getText(parsed), "finishDetailDismiss", "native dismissal completion owns the editor handoff");
assert.equal(attributeExpression(detailsModal.openingElement.attributes, "onRequestClose")?.getText(parsed), "closeDetails");
let nestedModals = 0;
let inlineConfirmation = false;
function inspectDetails(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "Modal") nestedModals++;
  if (ts.isConditionalExpression(node) && node.condition.getText(parsed) === "detailConfirmation?.expenseId === detailExp.id") inlineConfirmation = true;
  ts.forEachChild(node, inspectDetails);
}
inspectDetails(detailsModal);
assert.equal(nestedModals, 1, "confirmation must not introduce another native Modal inside Details");
assert(inlineConfirmation, "the same Details modal renders the selected expense's inline confirmation");

type Action = "repay" | "undo" | "settle" | "reopen" | "delete";
type Confirmation = { expenseId: string; action: Action; title: string; message: string; label: string };
type ExpenseRecord = { id: string; title: string; version: number };
type Call = { action: Action; args: unknown[] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const original: ExpenseRecord = { id: "expense", title: "Dinner", version: 1 };
  const calls: Call[] = [];
  const edits: ExpenseRecord[] = [];
  const transitions: string[] = [];
  let write: () => Promise<boolean> = async () => true;
  let haptics = 0;
  const bindings: Record<string, any> = {
    Error, Set,
    detailExpenseId: null,
    detailVisible: false,
    detailConfirmation: null as Confirmation | null,
    actionError: null,
    expenses: [original],
    detailExp: original,
    pendingEditRef: { current: null },
    runningExpenseIdsRef: { current: new Set<string>() },
    runningExpenseIds: new Set<string>(),
    pendingExpenseSet: new Set<string>(),
    expenseSync: { ready: true },
    currentUserId: "debtor",
    setDetailExpenseId: (value: string | null) => { bindings.detailExpenseId = value; transitions.push(`selection:${value}`); },
    setDetailVisible: (value: boolean) => { bindings.detailVisible = value; transitions.push(`visible:${value}`); },
    setDetailConfirmation: (value: Confirmation | null) => { bindings.detailConfirmation = value; transitions.push(`confirmation:${value?.action ?? "none"}`); },
    setActionError: (value: string | null) => { bindings.actionError = value; },
    setRunningExpenseIds: (value: Set<string>) => { bindings.runningExpenseIds = value; },
    openEditModal: (expense: ExpenseRecord) => { edits.push(expense); transitions.push("edit"); },
    hapticSuccess: () => { haptics++; transitions.push("success"); },
    // Any reintroduction of global confirmation or timer-based handoff fails at execution.
    confirm: () => assert.fail("expense confirmation must stay inside Details"),
    popup: () => assert.fail("expense confirmation must stay inside Details"),
    Alert: { alert: () => assert.fail("expense confirmation must stay inside Details") },
    setTimeout: () => assert.fail("native dismissal handoff must not depend on a timer"),
  };
  for (const [name, action] of [
    ["markPersonPaid", "repay"], ["undoPersonPaid", "undo"], ["settleExpense", "settle"],
    ["reopenExpense", "reopen"], ["deleteExpense", "delete"],
  ] as const) bindings[name] = (...args: unknown[]) => { calls.push({ action, args }); return write(); };
  const exports: Record<string, (...args: any[]) => any> = {};
  bindings.exports = exports;
  const code = callbackNames.map(name => `const ${name} = ${initializers.get(name)!.getText(parsed)}; exports.${name} = ${name};`).join("\n") + `\nexports.beginEdit = ${actualBeginEdit.getText(parsed)};`;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, bindings);
  return {
    bindings, original, calls, edits, transitions, callbacks: exports,
    set write(value: () => Promise<boolean>) { write = value; },
    get haptics() { return haptics; },
  };
}

// Every destructive/payment action asks in the currently selected Details surface.
for (const action of ["repay", "undo", "settle", "reopen", "delete"] as const) {
  const f = fixture();
  f.callbacks.openDetails(f.original.id);
  f.callbacks.requestExpenseAction(f.original, action);
  assert.equal(f.bindings.detailVisible, true);
  assert.equal(f.bindings.detailExpenseId, "expense");
  assert.equal(f.bindings.detailConfirmation.action, action);
  assert.equal(f.bindings.detailConfirmation.expenseId, "expense");
  assert(f.bindings.detailConfirmation.title.length > 0 && f.bindings.detailConfirmation.message.length > 0);
  assert.deepEqual(f.calls, [], "requesting confirmation cannot mutate the expense");
  assert.equal(f.haptics, 0);
  assert(!f.transitions.includes("visible:false"), "requesting an action does not dismiss Details to open another modal");
}

// Real acknowledgements gate success; the synchronous ref also blocks rapid duplicate presses.
for (const action of ["repay", "undo", "settle", "reopen", "delete"] as const) {
  const f = fixture();
  const acknowledgement = deferred<boolean>();
  f.write = () => acknowledgement.promise;
  f.callbacks.requestExpenseAction(f.original, action);
  const pending = f.callbacks.performExpenseAction();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, action);
  assert.deepEqual(f.calls[0].args, action === "repay" ? ["expense", "debtor"] : ["expense"]);
  assert.equal(f.bindings.runningExpenseIdsRef.current.has("expense"), true);
  assert.equal(f.bindings.runningExpenseIds.has("expense"), true);
  assert.equal(f.haptics, 0, "pressing Confirm is not a successful write");
  assert.equal(f.bindings.detailConfirmation.action, action, "confirmation remains visible while saving");
  await f.callbacks.performExpenseAction();
  assert.equal(f.calls.length, 1, "a second press before acknowledgement cannot duplicate the mutation");
  acknowledgement.resolve(true);
  await pending;
  assert.equal(f.haptics, 1);
  assert.equal(f.bindings.detailConfirmation, null);
  assert.equal(f.bindings.actionError, null);
  assert.equal(f.bindings.runningExpenseIdsRef.current.size, 0);
  assert.equal(f.bindings.runningExpenseIds.size, 0);
  assert.equal(f.bindings.detailVisible, action !== "delete");
  assert.equal(f.bindings.detailExpenseId, "expense", "even a completed delete leaves modal selection for native dismissal cleanup");
}

// Failed, unavailable, loading and already-pending operations never report success.
{
  const f = fixture();
  const acknowledgement = deferred<boolean>();
  f.write = () => acknowledgement.promise;
  f.callbacks.requestExpenseAction(f.original, "settle");
  const pending = f.callbacks.performExpenseAction();
  acknowledgement.reject(new Error("The server rejected this settlement."));
  await pending;
  assert.equal(f.bindings.actionError, "The server rejected this settlement.");
  assert.equal(f.bindings.detailVisible, true);
  assert.equal(f.bindings.detailConfirmation.action, "settle", "a rejected write keeps context and confirmation available");
  assert.equal(f.haptics, 0);
  assert.equal(f.bindings.runningExpenseIdsRef.current.size, 0);
  f.write = async () => true;
  await f.callbacks.performExpenseAction();
  assert.equal(f.haptics, 1, "the same confirmation can retry after a rejection");
}
{
  const f = fixture();
  f.write = async () => false;
  f.callbacks.requestExpenseAction(f.original, "repay");
  await f.callbacks.performExpenseAction();
  assert.match(f.bindings.actionError, /no longer available/);
  assert.equal(f.haptics, 0, "an unchanged/rejected domain transition is not success");
  assert.equal(f.bindings.detailConfirmation.action, "repay");
}
for (const block of ["loading", "outbox", "running", "no-confirmation"] as const) {
  const f = fixture();
  if (block !== "no-confirmation") f.callbacks.requestExpenseAction(f.original, "settle");
  if (block === "loading") f.bindings.expenseSync.ready = false;
  if (block === "outbox") f.bindings.pendingExpenseSet.add("expense");
  if (block === "running") f.bindings.runningExpenseIdsRef.current.add("expense");
  await f.callbacks.performExpenseAction();
  assert.equal(f.calls.length, 0, `blocked ${block} action cannot send`);
  assert.equal(f.haptics, 0);
  if (block === "loading") assert.match(f.bindings.actionError, /still loading/);
}
{
  const f = fixture();
  const acknowledgement = deferred<boolean>();
  f.write = () => acknowledgement.promise;
  const action = { expenseId: "expense", action: "settle", title: "", message: "", label: "" };
  const pending = f.callbacks.performExpenseAction(action);
  assert.equal(f.bindings.detailVisible, false, "the row settlement shortcut need not present a modal");
  assert.equal(f.haptics, 0);
  await f.callbacks.performExpenseAction(action);
  assert.equal(f.calls.length, 1, "the row shortcut has the same duplicate guard");
  acknowledgement.resolve(true);
  await pending;
  assert.equal(f.haptics, 1, "the row shortcut also waits for acknowledgement");
}

// The Edit handler requests dismissal; only its native completion opens the editor.
{
  const f = fixture();
  f.callbacks.openDetails("expense");
  f.callbacks.beginEdit();
  assert.equal(f.bindings.detailVisible, false);
  assert.equal(f.bindings.detailExpenseId, "expense", "closing retains the selected record so the iOS Modal remains mounted through its slide");
  assert.equal(f.bindings.pendingEditRef.current, f.original);
  assert.deepEqual(f.edits, [], "neither the Edit press nor closeDetails can present the editor before onDismiss");
  const fresh = { ...f.original, title: "Dinner updated on another device", version: 2 };
  f.bindings.expenses = [fresh];
  f.callbacks.finishDetailDismiss();
  assert.equal(f.bindings.detailExpenseId, null);
  assert.equal(f.bindings.pendingEditRef.current, null);
  assert.equal(f.edits.length, 1);
  assert.equal(f.edits[0], fresh, "dismissal opens the fresh authoritative expense rather than the captured old row");
  f.callbacks.finishDetailDismiss();
  assert.equal(f.edits.length, 1, "duplicate native completion cannot open the editor twice");
}
{
  const f = fixture();
  f.callbacks.openDetails("expense");
  f.callbacks.beginEdit();
  f.bindings.expenses = [];
  f.callbacks.finishDetailDismiss();
  assert.deepEqual(f.edits, []);
  assert.match(f.bindings.actionError, /no longer available/);
  assert.equal(f.bindings.pendingEditRef.current, null);
}
{
  const f = fixture();
  f.callbacks.requestExpenseAction(f.original, "settle");
  f.callbacks.closeDetails();
  assert.equal(f.bindings.detailVisible, false);
  assert.equal(f.bindings.detailConfirmation, null);
  assert.equal(f.bindings.detailExpenseId, "expense");
  f.callbacks.finishDetailDismiss();
  assert.equal(f.bindings.detailExpenseId, null);
  assert.deepEqual(f.edits, [], "ordinary closing cannot open an editor");
}

// The actual form callback also waits for persistence and preserves the draft's
// idempotency identity across retry instead of creating a second Shopping charge.
assert(initializers.has("doSendIOU"));
function formFixture() {
  const creates: { payload: any; id: string }[] = [];
  const updates: { id: string; payload: any }[] = [];
  const links: unknown[][] = [];
  let write: () => Promise<any> = async () => "saved-expense";
  let successes = 0;
  let closes = 0;
  const bindings: Record<string, any> = {
    Error, ExpensePendingError,
    buildStoredExpenseAllocations, allocationsToDollarSplits, centsToDollars,
    submittingIouRef: { current: false }, submittingIou: false,
    canSubmit: true, financialFieldsLocked: false,
    allocationValidation: { valid: true, totalCents: 601, allocationCents: { payer: 300, debtor: 301 } },
    validExpenseDate: "2026-11-08", editingExpenseId: null, editingExpense: undefined,
    expTitle: "  Groceries  ", expCategory: "groceries", expNotes: "  Receipt  ",
    expParticipants: ["payer", "debtor"], expPaidBy: "payer", allocationMode: "exact",
    expenseSource: undefined, enteredTotalCents: 601, expenseDraftId: "stable-draft-id",
    draftSavedRef: { current: false }, queuedIou: false, iouSubmitError: null,
    setSubmittingIou: (value: boolean) => { bindings.submittingIou = value; },
    setIouSubmitError: (value: string | null) => { bindings.iouSubmitError = value; },
    setQueuedIou: (value: boolean) => { bindings.queuedIou = value; },
    addExpense: (payload: unknown, id: string) => { creates.push({ payload, id }); return write(); },
    updateExpense: (id: string, payload: unknown) => { updates.push({ id, payload }); return write(); },
    linkShoppingItemsToExpense: (...args: unknown[]) => { links.push(args); },
    hapticSuccess: () => { successes++; }, closeIou: () => { closes++; },
  };
  const exports: { send?: () => Promise<void> } = {};
  runInNewContext(ts.transpileModule(`exports.send = ${initializers.get("doSendIOU")!.getText(parsed)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, Object.assign(bindings, { exports }));
  return {
    bindings, creates, updates, links, send: exports.send!,
    set write(value: () => Promise<any>) { write = value; },
    get successes() { return successes; }, get closes() { return closes; },
  };
}
{
  const f = formFixture();
  f.bindings.expenseSource = { type: "shopping-item", householdId: "home", shoppingListId: "list", shoppingListName: "Groceries", shoppingItemIds: ["item"] };
  const acknowledgement = deferred<string>();
  f.write = () => acknowledgement.promise;
  const pending = f.send();
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].id, "stable-draft-id");
  assert.equal(f.creates[0].payload.amountCents, 601);
  assert.equal(f.creates[0].payload.allocations.reduce((sum: number, allocation: { amountCents: number }) => sum + allocation.amountCents, 0), 601);
  assert.equal(f.bindings.submittingIouRef.current, true);
  assert.equal(f.successes, 0);
  assert.equal(f.closes, 0);
  assert.deepEqual(f.links, [], "Shopping links cannot precede the authoritative expense ID");
  await f.send();
  assert.equal(f.creates.length, 1, "rapid Send cannot enqueue a duplicate charge");
  acknowledgement.resolve("server-expense-id");
  await pending;
  assert.equal(f.successes, 1);
  assert.equal(f.closes, 1);
  assert.equal(f.links[0][1], "server-expense-id");
  assert.equal(f.bindings.draftSavedRef.current, true);
  assert.equal(f.bindings.submittingIouRef.current, false);
}
{
  const f = formFixture();
  f.write = async () => { throw new ExpensePendingError(); };
  await f.send();
  assert.equal(f.bindings.queuedIou, true);
  assert.match(f.bindings.iouSubmitError, /saved on this device/i);
  assert.equal(f.successes, 0);
  assert.equal(f.closes, 0);
  assert.equal(f.bindings.expTitle, "  Groceries  ", "pending requests preserve the user's form");
  f.write = async () => { throw new Error("The server rejected the expense."); };
  await f.send();
  assert.equal(f.creates[1].id, f.creates[0].id, "retry uses the original stable creation ID");
  assert.equal(f.bindings.iouSubmitError, "The server rejected the expense.");
  assert.equal(f.successes, 0);
  assert.equal(f.closes, 0);
}
{
  const f = formFixture();
  f.bindings.editingExpenseId = "paid-expense";
  f.bindings.financialFieldsLocked = true;
  f.bindings.allocationValidation = { valid: false };
  f.bindings.validExpenseDate = null;
  const acknowledgement = deferred<boolean>();
  f.write = () => acknowledgement.promise;
  const pending = f.send();
  assert.equal(f.creates.length, 0);
  assert.equal(f.updates[0].id, "paid-expense");
  assert.deepEqual(Object.keys(f.updates[0].payload).sort(), ["category", "notes", "title"], "paid descriptive edits preserve financial data, former participants and recurring metadata by omitting them");
  assert.equal(f.successes, 0);
  acknowledgement.resolve(true);
  await pending;
  assert.equal(f.successes, 1);
}
{
  const f = formFixture();
  f.bindings.editingExpenseId = "legacy-expense";
  f.bindings.editingExpense = { recurring: "custom", recurringCustom: "Old quarterly label" };
  f.write = async () => true;
  await f.send();
  assert.equal(f.updates[0].payload.recurring, "custom");
  assert.equal(f.updates[0].payload.recurringCustom, "Old quarterly label", "ordinary edits retain unsupported legacy recurrence metadata");
}
console.log("expense UI callback and modal-handoff state tests passed (native iPhone presentation requires device testing)");
