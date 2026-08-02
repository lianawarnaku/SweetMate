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

export type ActiveSweetMembership = {
  sweetId: string;
  userId: string;
  status: "active" | "invited" | "left" | "removed";
} | null | undefined;

/**
 * Single source of truth for "is this authenticated user an active member of
 * the currently selected household?". My Home, Group, and AppContext's own
 * mutation gates each used to reimplement this comparison independently; any
 * one of the three drifting out of sync silently disabled chore controls for
 * non-host members. Every caller must go through this function instead of
 * inlining the sweetId/userId/status comparison again.
 */
export function isActiveSweetMember(
  activeSweet: ActiveSweetMembership,
  householdId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(
    activeSweet &&
      householdId &&
      currentUserId &&
      activeSweet.sweetId === householdId &&
      activeSweet.userId === currentUserId &&
      activeSweet.status === "active",
  );
}

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
