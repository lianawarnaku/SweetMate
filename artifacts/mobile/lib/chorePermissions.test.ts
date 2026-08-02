import { resolveChorePermissions } from "./chorePermissions.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const chore = { assignedTo: "member-a", creatorId: "owner", assignmentMode: "specific-person" as const, completed: false };
const assigned = resolveChorePermissions({ currentUserId: "member-a", isActiveMember: true, isOwner: false, chore });
assert(assigned.canView && assigned.canComplete, "assigned member can view and complete");
assert(assigned.canEdit && assigned.canReassign, "assigned member can edit and reassign");
assert(!assigned.canDelete, "assigned member cannot delete another creator's chore");
assert(assigned.canAddToOwnCalendar, "assigned member can export to own calendar");

const other = resolveChorePermissions({ currentUserId: "member-b", isActiveMember: true, isOwner: false, chore });
assert(other.canComplete && other.canNudge, "active member can pick up and nudge");
assert(!other.canEdit && !other.canDelete, "unrelated member cannot manage chore");

const owner = resolveChorePermissions({ currentUserId: "owner", isActiveMember: true, isOwner: true, chore });
assert(owner.canEdit && owner.canDelete, "owner has management override");

const outsider = resolveChorePermissions({ currentUserId: "outsider", isActiveMember: false, isOwner: false, chore });
assert(!Object.values(outsider).some(Boolean), "cross-household user has no permissions");

console.log("chore permission tests passed");
