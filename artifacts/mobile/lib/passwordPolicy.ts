export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_LENGTH = 128;
export function newPasswordValidation(password: string): string | null {
  if (password.length < NEW_PASSWORD_MIN_LENGTH) return `Use at least ${NEW_PASSWORD_MIN_LENGTH} characters for your new password.`;
  if (password.length > NEW_PASSWORD_MAX_LENGTH) return `Use no more than ${NEW_PASSWORD_MAX_LENGTH} characters.`;
  return null;
}
