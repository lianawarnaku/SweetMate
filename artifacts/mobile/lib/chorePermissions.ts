export type ChorePermissionInput = {
  currentUserId: string;
  isActiveMember: boolean;
  isOwner: boolean;
  chore: {
    assignedTo: string;
    creatorId?: string;
    assignmentMode?: "specific-person" | "round-robin" | "unassigned";
    completed: boolean;
  };
};

export type ChorePermissions = {
  canView: boolean;
  canComplete: boolean;
  canEdit: boolean;
  canReassign: boolean;
  canDelete: boolean;
  canNudge: boolean;
  canAddToOwnCalendar: boolean;
};

/** Shared client chore-action matrix. Household RLS independently protects writes. */
export function resolveChorePermissions({
  currentUserId,
  isActiveMember,
  isOwner,
  chore,
}: ChorePermissionInput): ChorePermissions {
  if (!currentUserId || !isActiveMember) {
    return {
      canView: false,
      canComplete: false,
      canEdit: false,
      canReassign: false,
      canDelete: false,
      canNudge: false,
      canAddToOwnCalendar: false,
    };
  }

  const isAssignee = chore.assignedTo === currentUserId;
  const isCreator = chore.creatorId === currentUserId;
  const isAvailableToHousehold = chore.assignmentMode === "unassigned" || !chore.assignedTo;
  const canManage = isOwner || isCreator || isAssignee;

  return {
    canView: true,
    // Group Chores intentionally allows an active member to pick up another
    // member's open chore. Reversing completion remains restricted.
    canComplete: !chore.completed || isAssignee || isOwner || isAvailableToHousehold,
    canEdit: canManage,
    canReassign: canManage,
    canDelete: isOwner || isCreator,
    canNudge: !chore.completed && Boolean(chore.assignedTo) && !isAssignee,
    canAddToOwnCalendar: true,
  };
}
