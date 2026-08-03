import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const appRoot = resolve(process.cwd(), "app/(tabs)");
const home = readFileSync(resolve(appRoot, "index.tsx"), "utf8");
const group = readFileSync(resolve(appRoot, "group.tsx"), "utf8");
const borrowing = readFileSync(resolve(appRoot, "borrow.tsx"), "utf8");
const expenses = readFileSync(resolve(appRoot, "expenses.tsx"), "utf8");
const shopping = readFileSync(resolve(appRoot, "shopping.tsx"), "utf8");
const context = readFileSync(resolve(process.cwd(), "context/AppContext.tsx"), "utf8");
const actionMenu = readFileSync(resolve(process.cwd(), "components/ActionMenuModal.tsx"), "utf8");
const chorePermissionsLib = readFileSync(resolve(process.cwd(), "lib/chorePermissions.ts"), "utf8");

assert(
    context.includes("setCurrentUserIdState(session?.user.id ?? CURRENT_USER_ID)") &&
    !context.includes("setCurrentUserIdState(data.currentUserId)") &&
    context.includes("isActiveSweetMember(activeSweet, householdId, session?.user.id)") &&
    context.includes("addChores, setChoreCompleted, completeChore"),
  "authenticated session identity and active membership must authorize chore actions",
);

assert(
  actionMenu.includes("runAfterDismiss?: boolean") &&
    actionMenu.includes("setTimeout(afterDismiss, 0)") &&
    home.includes("runAfterDismiss: true") &&
    home.includes("runAfterDismiss: calendarDestination == null") &&
    group.includes("runAfterDismiss: true") &&
    group.includes("runAfterDismiss: calendarDestination == null"),
  "chore actions that present editors, alerts, or pickers must run after the shared menu dismisses",
);

assert(
  chorePermissionsLib.includes("export function isActiveSweetMember") &&
    home.includes("isActiveSweetMember(activeSweet, householdId, currentUserId)") &&
    group.includes("isActiveSweetMember(activeSweet, householdId, currentUserId)") &&
    !home.includes('activeSweet.status === "active"') &&
    !group.includes('activeSweet.status === "active"'),
  "My Home, Group, and AppContext must resolve active membership through the single isActiveSweetMember helper instead of three independently drifting inline comparisons",
);

assert(
  home.includes('{currentUser?.name ?? "You"}') &&
    !home.includes('{currentUser?.name ?? "You"} 🏠'),
  "My Sweet must render the current user's name without the appended home emoji",
);

assert(
  home.includes('(["today", "done", "week"] as Filter[])'),
  "My Chores filters must render Today, Done, Week",
);
assert(
  home.includes("{chore.points} pts") && home.includes("pointsEnabled ?"),
  "My Home must replace the leading category visual with chore points when enabled",
);
assert(
  !home.includes("Done!") && !group.includes("Done!"),
  "completed chore rows must not render the brown Done tile",
);
assert(
  group.includes("style={styles.moreActionsButton}") &&
    group.includes("event.stopPropagation()"),
  "Group overflow must use a dedicated non-bubbling touch target",
);
assert(
  home.includes("style={styles.progressSection}") &&
    !home.includes("styles.progressCard"),
  "My Progress must render without its former card shell",
);
assert(
  !borrowing.includes("styles.itemIcon") &&
    !borrowing.includes("styles.cardLeft"),
  "borrowing rows must not render or reserve space for the leading status circle",
);
assert(
  borrowing.includes("<ActionMenuModal") &&
    borrowing.includes("onLongPress=") &&
    borrowing.includes("actionBorrowId") &&
    borrowing.includes('label: "Edit"') &&
    borrowing.includes('label: "Delete"') &&
    !borrowing.includes('<Feather name="edit-2" size={15}') &&
    !borrowing.includes('<Feather name="trash-2" size={15}'),
  "borrowing rows must use one shared long-press action menu without inline edit/delete icons",
);
assert(
  borrowing.includes("accessibilityActions=") &&
    borrowing.includes('label: "More actions"') &&
    borrowing.includes("showReturnAction ? ("),
  "borrowing actions must remain accessible without nesting the return control in the long-press target",
);
assert(
  home.includes("style={styles.categoryVisual}") &&
    home.includes(
      "style={[styles.pointsVisual, { backgroundColor: colors.secondary }]}",
    ) &&
    !home.includes("styles.categoryIcon"),
  "My Chores must keep category icons unboxed and render points in their compact badge",
);
assert(
  !group.includes("styles.activityHeaderIcon, { backgroundColor:"),
  "Room Health and Roommates heading icons must render without tiles",
);
assert(
  group.includes("const visibleChores = rc.slice(0, visibleLimit)") &&
    group.includes("visibleLimit + 50"),
  "Group Chores must render large sections in bounded batches",
);
assert(
  !expenses.includes("styles.expCatIcon, { backgroundColor:"),
  "IOU category icons must render without tiles",
);
assert(
  shopping.includes("style={[styles.inlineYou, { color: colors.foreground }]}") &&
    !shopping.includes('listAssignee.id === currentUserId ? "You" : listAssignee.name'),
  "the current-user shopping assignment must render as plain inline text",
);
assert(
  shopping.includes('"Create item expense"') &&
    shopping.includes('type: "shopping-item"') &&
    shopping.includes("setPendingIouDraft(draft)") &&
    expenses.includes('expenseSource?.type === "shopping-item"'),
  "individual Shopping expenses must open the standard editable IOU draft and link only after save",
);
assert(
  shopping.includes("router.navigate(\"/(tabs)/expenses\")") &&
    !shopping.includes("draftOpeningRef") &&
    !shopping.includes("draftOpeningRef.current") &&
    expenses.includes("setPendingIouDraft(null)") &&
    expenses.includes("setShowExpenseModal(true)"),
  "the Shopping IOU intent must navigate without a timer and be consumed exactly once",
);
assert(
  shopping.includes("paidBy: currentUserId") &&
    shopping.includes("householdId,") &&
    expenses.includes("An active IOU already exists for this Shopping item.") &&
    expenses.includes("value={expDate}") &&
    !context.includes("convertedExpenseId: expenseId, completed: true"),
  "Shopping-item drafts must preserve household/date metadata, prevent active duplicates, and leave the item unchecked",
);
assert(
  !shopping.includes("listDollarBtn") &&
    !shopping.includes("styles.itemMoneyBtn") &&
    shopping.includes('badge: "$$$"') &&
    shopping.includes('label: "Create expense from list"'),
  "Shopping expense actions must live only in the shared list/item long-press menu",
);
assert(
  expenses.includes("<ActionMenuModal") &&
    !expenses.includes('<Feather name="edit-2" size={15}') &&
    !expenses.includes('name="trash-2"\n                              size={15}'),
  "expense rows must use the shared long-press menu instead of edit and trash icons",
);
assert(
  home.includes("<ActionMenuModal") &&
    group.includes("<ActionMenuModal") &&
    shopping.includes("<ActionMenuModal"),
  "Shopping, Group, and My Sweet must share the app action-menu presentation",
);
assert(
  home.includes('key: "calendar"') &&
    !home.includes("onAddToCalendar") &&
    group.includes('key: "nudge"') &&
    group.includes('key: "calendar"') &&
    !group.includes("styles.nudgeBtn"),
  "chore row secondary actions must live in the shared action menu",
);
assert(
  group.includes("initialConfirmationAction={completionAction}") &&
    !group.includes('"complete_chore",\\n        "Complete chore?"'),
  "chore completion must use the shared app-styled confirmation shell",
);
assert(
  group.includes('onClose={() => setActionChoreId(null)}') &&
    group.includes("setEditingChoreId(actionChore.id)") &&
    group.includes("setShowAddChoreModal(true)"),
  "chore reassignment must wait for the action menu to close before presenting the editor",
);
assert(
  context.includes("const localChoresById = new Map(") &&
    context.includes("const local = localChoresById.get(remote.id);"),
  "chore realtime reconciliation must use indexed lookup instead of scanning the list per record",
);
assert(
  context.includes('reportSupabaseError("save completed chore state"') &&
    context.includes("chorePersistenceQueueRef.current.then(") &&
    context.includes("chores: nextChores") &&
    context.includes("roommates: nextRoommates"),
  "completion must immediately persist the combined canonical chore and score state",
);
assert(
  group.includes("key={chore.id}") &&
    group.includes("a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)") &&
    group.includes("accessibilityState={{ checked: chore.completed }}") &&
    group.includes('textDecorationLine: chore.completed'),
  "Group rows must retain stable identity and visibly expose canonical completion state",
);
