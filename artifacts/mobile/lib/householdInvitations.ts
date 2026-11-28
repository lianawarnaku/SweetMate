import * as Crypto from "expo-crypto";
export const normalizeInvitation = (value: string) =>
  value.trim().replace(/[\s-]/g, "").toUpperCase();
export async function invitationDigest(value: string) {
  const normalized = normalizeInvitation(value);
  if (!/^(?:[A-Z0-9]{8}|[A-F0-9]{12}|[A-F0-9]{32})$/.test(normalized))
    throw new Error(
      "Enter the household code or the personal invitation from your host.",
    );
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    normalized,
  );
}
export function joinedHousehold(result: unknown): string {
  const value = result as {
    ok?: boolean;
    household_id?: string;
    message?: string;
    retry_after_seconds?: number;
  } | null;
  if (
    value?.ok !== true ||
    !value.household_id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.household_id,
    )
  )
    throw new Error(
      value?.message ??
        "That invitation is unavailable. Ask the host for a new invitation or approval.",
    );
  return value.household_id;
}
export type HouseholdInvitations = {
  enabled: boolean;
  removed: { id: string; name: string }[];
  invitations: {
    id: string;
    user_id: string;
    expires_at: string;
    suffix: string | null;
    approval_only: boolean;
  }[];
};
