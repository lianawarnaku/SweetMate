import { isActiveSweetMember, resolveChorePermissions } from "./chorePermissions.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Regression fixture: one household, one owner, one regular member, one
// task assigned to the regular member, one shared (unassigned) task, and
// one already-completed occurrence. Exercises the exact identity-matching
// glue (`isActiveSweetMember`) that My Home, Group, and AppContext each used
// to reimplement independently — the duplication that let a non-host member
// silently lose chore controls while the host kept working.
const HOUSEHOLD_ID = "household-1";
const OWNER_ID = "user-owner";
const MEMBER_ID = "user-member";
const memberships = [
  { sweetId: HOUSEHOLD_ID, userId: OWNER_ID, status: "active" as const },
  { sweetId: HOUSEHOLD_ID, userId: MEMBER_ID, status: "active" as const },
];
const assignedTask = { assignedTo: MEMBER_ID, creatorId: OWNER_ID, assignmentMode: "specific-person" as const, completed: false };
const sharedTask = { assignedTo: "", creatorId: OWNER_ID, assignmentMode: "unassigned" as const, completed: false };
const completedOccurrence = { assignedTo: MEMBER_ID, creatorId: OWNER_ID, assignmentMode: "specific-person" as const, completed: true };

const ownerActiveSweet = memberships.find((m) => m.userId === OWNER_ID);
const memberActiveSweet = memberships.find((m) => m.userId === MEMBER_ID);

assert(
  isActiveSweetMember(memberActiveSweet, HOUSEHOLD_ID, MEMBER_ID),
  "an active regular member resolves as an active household member",
);
assert(
  isActiveSweetMember(ownerActiveSweet, HOUSEHOLD_ID, OWNER_ID),
  "the owner also resolves as an active household member",
);
assert(
  !isActiveSweetMember(memberActiveSweet, "other-household", MEMBER_ID),
  "membership for a different household does not authorize the current one",
);
assert(
  !isActiveSweetMember({ sweetId: HOUSEHOLD_ID, userId: MEMBER_ID, status: "removed" }, HOUSEHOLD_ID, MEMBER_ID),
  "a removed membership does not authorize chore actions",
);
assert(
  !isActiveSweetMember(null, HOUSEHOLD_ID, MEMBER_ID),
  "no active membership means no authorization",
);

const memberIsActive = isActiveSweetMember(memberActiveSweet, HOUSEHOLD_ID, MEMBER_ID);
const memberPermissions = resolveChorePermissions({
  currentUserId: MEMBER_ID,
  isActiveMember: memberIsActive,
  isOwner: false,
  chore: assignedTask,
});
assert(
  memberPermissions.canView && memberPermissions.canComplete,
  "non-host assignee can view and complete (checkbox path) their assigned task",
);
assert(
  memberPermissions.canEdit,
  "non-host assignee sees at least one permitted three-dot action (edit)",
);

const memberSharedPermissions = resolveChorePermissions({
  currentUserId: MEMBER_ID,
  isActiveMember: memberIsActive,
  isOwner: false,
  chore: sharedTask,
});
assert(
  memberSharedPermissions.canComplete,
  "non-host member can pick up a shared/unassigned task",
);

const memberCompletedPermissions = resolveChorePermissions({
  currentUserId: MEMBER_ID,
  isActiveMember: memberIsActive,
  isOwner: false,
  chore: completedOccurrence,
});
assert(
  memberCompletedPermissions.canComplete,
  "the assignee can reverse their own completed occurrence",
);
assert(
  !memberCompletedPermissions.canDelete,
  "a non-host, non-creator member cannot delete a completed occurrence",
);

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
