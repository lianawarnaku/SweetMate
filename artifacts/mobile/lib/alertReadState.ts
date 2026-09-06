type RecipientAlert = {
  recipientId?: string;
  readAt?: string;
};

export function markVisibleAlertsRead<T extends RecipientAlert>(
  alerts: T[],
  currentUserId: string | undefined,
  readAt: string,
): T[] {
  return alerts.map((alert) => {
    const isVisibleToCurrentUser =
      !alert.recipientId || alert.recipientId === currentUserId;
    return alert.readAt || !isVisibleToCurrentUser
      ? alert
      : { ...alert, readAt };
  });
}
