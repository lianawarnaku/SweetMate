/** UI-only owner selector; never written into a UUID database column. */
export const OTHER_BORROW_OWNER = "other";

export function isBorrowReturnOwner(item: { borrowedFrom: string; creatorId?: string }, userId: string) {
  return item.borrowedFrom === userId || (item.borrowedFrom === OTHER_BORROW_OWNER && item.creatorId === userId);
}

export function hasValidBorrowParticipants(
  ownerId: string,
  borrowerId: string,
  householdMemberIds: Iterable<string>,
  externalOwnerName?: string,
) {
  if (!ownerId || !borrowerId) return false;
  const members = new Set(householdMemberIds);
  if (!members.has(borrowerId)) return false;
  if (ownerId === OTHER_BORROW_OWNER) {
    const name = externalOwnerName?.trim() ?? "";
    return name.length > 0 && name.length <= 100;
  }
  return members.has(ownerId);
}

export function canManageBorrowItem(
  item: {
    visibility?: "shared" | "private";
    ownerId?: string;
    creatorId?: string;
    borrowedBy?: string;
    borrowedFrom: string;
  },
  currentUserId: string,
  isHost: boolean,
) {
  if (item.visibility === "private") {
    return item.ownerId === currentUserId;
  }
  const canManageLegacy =
    !item.creatorId &&
    (item.borrowedBy === currentUserId ||
      item.borrowedFrom === currentUserId);
  return isHost || item.creatorId === currentUserId || canManageLegacy;
}

export function canSaveBorrowDraft({
  item,
  ownerId,
  borrowerId,
  householdMemberIds,
  externalOwnerName,
}: {
  item: string;
  ownerId: string;
  borrowerId: string;
  householdMemberIds: Iterable<string>;
  externalOwnerName?: string;
}) {
  return (
    item.trim().length > 0 &&
    hasValidBorrowParticipants(ownerId, borrowerId, householdMemberIds, externalOwnerName)
  );
}
