import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Auth = SupabaseClient["auth"];
import { newPasswordValidation } from "./passwordPolicy";
export { NEW_PASSWORD_MIN_LENGTH } from "./passwordPolicy";
export const RECOVERY_FORM_LIFETIME_MS = 15 * 60_000;
export class PasswordFlowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PasswordFlowError";
  }
}
export function passwordValidation(
  password: string,
  confirmation: string,
): string | null {
  const invalid = newPasswordValidation(password);
  if (invalid) return invalid;
  if (password !== confirmation) return "The new passwords do not match.";
  return null;
}
export function passwordFlowError(error: unknown): PasswordFlowError {
  if (error instanceof PasswordFlowError) return error;
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    [
      "otp_expired",
      "pkce_code_verifier_not_found",
      "flow_state_expired",
      "flow_state_not_found",
      "bad_code_verifier",
      "session_not_found",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "bad_jwt",
    ].includes(code)
  )
    return new PasswordFlowError(
      "expired",
      "This reset link has expired or has already been used. Request a new email.",
    );
  if (["reauthentication_needed", "reauthentication_not_valid"].includes(code))
    return new PasswordFlowError(
      "reauthentication",
      "Confirm the security code sent to your email, then try again.",
    );
  if (code === "same_password")
    return new PasswordFlowError(
      code,
      "Choose a password you have not used for this account.",
    );
  if (code === "weak_password")
    return new PasswordFlowError(
      code,
      "Choose a stronger password with at least 12 characters.",
    );
  if (
    [
      "invalid_credentials",
      "invalid_password",
      "current_password_required",
      "current_password_mismatch",
    ].includes(code)
  )
    return new PasswordFlowError(
      "current_password",
      "Your current password is incorrect.",
    );
  if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(code))
    return new PasswordFlowError(
      "rate_limit",
      "Please wait before requesting another email or trying again.",
    );
  // Never render or log provider responses that might include credentials/URLs.
  return new PasswordFlowError(
    "unavailable",
    "This could not be completed. Check your connection and try again.",
  );
}
export function recoveryLink(url: string, redirectTo: string): URL | null {
  try {
    const candidate = new URL(url),
      expected = new URL(redirectTo);
    if (
      candidate.protocol !== expected.protocol ||
      candidate.host !== expected.host ||
      candidate.pathname.replace(/\/$/, "") !==
        expected.pathname.replace(/\/$/, "")
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}
function callbackParams(url: URL) {
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.replace(/^#/, "")).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}
function recoveryCredentials(url: URL, now: number) {
  const params = callbackParams(url);
  if (params.has("error") || params.has("error_code"))
    throw new PasswordFlowError(
      "expired",
      "This reset link is invalid, expired or already used. Request a new email.",
    );
  const hash = params.get("token_hash"),
    code = params.get("code"),
    access = params.get("access_token"),
    refresh = params.get("refresh_token");
  if (
    [Boolean(hash), Boolean(code), Boolean(access || refresh)].filter(Boolean)
      .length !== 1
  )
    throw new PasswordFlowError(
      "expired",
      "This reset link is incomplete. Request a new email.",
    );
  if (!code && params.get("type") !== "recovery")
    throw new PasswordFlowError(
      "expired",
      "Open the password reset link from your recovery email.",
    );
  const expires = Number(params.get("expires_at"));
  if (access && (!refresh || (expires && expires * 1000 <= now)))
    throw new PasswordFlowError(
      "expired",
      "This reset link has expired. Request a new email.",
    );
  return { hash, code, access, refresh };
}
const scopeError = () =>
  new PasswordFlowError(
    "account_changed",
    "Your signed-in account changed. Reopen password settings for the current account.",
  );
export function createPasswordServices(auth: Auth) {
  async function assertUser(id: string) {
    const current = await auth.getSession();
    if (current.error || current.data.session?.user.id !== id)
      throw scopeError();
  }
  return {
    async request(email: string, redirectTo: string) {
      const normalized = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
        throw new PasswordFlowError("email", "Enter a valid email address.");
      try {
        const { error } = await auth.resetPasswordForEmail(normalized, {
          redirectTo,
        });
        if (error) throw error;
      } catch (error) {
        throw passwordFlowError(error);
      }
      // Success deliberately does not reveal whether an account exists.
    },
    async change(
      id: string,
      password: string,
      confirmation: string,
      currentPassword?: string,
      nonce?: string,
    ) {
      const validation = passwordValidation(password, confirmation);
      if (validation) throw new PasswordFlowError("validation", validation);
      await assertUser(id);
      try {
        const verified = await auth.getUser();
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== id) throw scopeError();
        await assertUser(id);
        if (currentPassword !== undefined) {
          if (!currentPassword || !verified.data.user.email)
            throw new PasswordFlowError(
              "current_password",
              "Enter your current password, or use email recovery.",
            );
          // A genuine password sign-in proves the current secret even on older
          // Auth servers that ignore the newer current_password attribute.
          const reauthenticated = await auth.signInWithPassword({
            email: verified.data.user.email,
            password: currentPassword,
          });
          if (reauthenticated.error) throw reauthenticated.error;
          if (reauthenticated.data.user?.id !== id) throw scopeError();
          await assertUser(id);
        }
        const { data, error } = await auth.updateUser({
          password,
          ...(currentPassword !== undefined
            ? { current_password: currentPassword }
            : {}),
          ...(nonce ? { nonce: nonce.trim() } : {}),
        });
        if (error) {
          if (
            currentPassword === undefined &&
            ["current_password_required", "current_password_mismatch"].includes(
              error.code ?? "",
            )
          ) {
            throw new PasswordFlowError(
              "expired",
              "This recovery session ended. Sign in with your new password if it was saved, or request a new reset email.",
            );
          }
          throw error;
        }
        if (data.user?.id !== id) throw scopeError();
        await assertUser(id);
      } catch (error) {
        throw passwordFlowError(error);
      }
    },
    async reauthenticate(id: string) {
      await assertUser(id);
      try {
        const { error } = await auth.reauthenticate();
        if (error) throw error;
      } catch (error) {
        throw passwordFlowError(error);
      }
      await assertUser(id);
    },
  };
}
export const passwordServices = createPasswordServices(supabase.auth);

export type RecoverySnapshot = {
  phase:
    | "checking"
    | "idle"
    | "confirm-signout"
    | "ready"
    | "expired"
    | "signout-required"
    | "success";
  userId?: string;
  expiresAt?: number;
  message?: string;
};
/** Recovery is kept outside household navigation and never persisted or tracked. */
export class PasswordRecoveryController {
  private snapshot: RecoverySnapshot = { phase: "checking" };
  private listeners = new Set<() => void>();
  private pendingUrl: URL | null = null;
  private previousUserId: string | null = null;
  private recoveryUserId: string | null = null;
  private processing = false;
  private saving = false;
  private lastUrl: string | null = null;
  constructor(
    private auth: Auth,
    private signOut: () => Promise<{ error: unknown }>,
    private now = Date.now,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: RecoverySnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((fn) => fn());
  }
  initialized() {
    if (this.snapshot.phase === "checking" && !this.processing)
      this.publish({ phase: "idle" });
  }
  observe(event: string, session: Session | null) {
    if (this.processing || this.saving) return;
    if (
      this.recoveryUserId &&
      (event === "SIGNED_OUT" || session?.user.id !== this.recoveryUserId)
    ) {
      this.recoveryUserId = null;
      this.publish({
        phase: "expired",
        message: "Your recovery session ended. Request a new reset email.",
      });
    }
  }
  expire() {
    if (
      this.snapshot.phase === "ready" &&
      this.now() >= (this.snapshot.expiresAt ?? 0)
    )
      this.publish({
        phase: "expired",
        message: "This password reset session expired. Request a new email.",
      });
  }
  async handle(url: URL) {
    if (
      this.processing ||
      this.saving ||
      (this.lastUrl === url.href && this.snapshot.phase === "ready")
    )
      return;
    this.processing = true;
    this.lastUrl = url.href;
    this.publish({ phase: "checking" });
    try {
      recoveryCredentials(url, this.now());
      const current = await this.auth.getSession();
      if (current.error) throw current.error;
      if (current.data.session) {
        this.pendingUrl = url;
        this.previousUserId = current.data.session.user.id;
        this.publish({ phase: "confirm-signout" });
        return;
      }
      await this.exchange(url);
    } catch (error) {
      this.fail(error);
    } finally {
      this.processing = false;
    }
  }
  async continueAfterSignOut() {
    if (!this.pendingUrl || this.processing || this.saving) return;
    this.processing = true;
    const url = this.pendingUrl;
    this.publish({ phase: "checking" });
    try {
      recoveryCredentials(url, this.now());
      const current = await this.auth.getSession();
      if (
        current.error ||
        (current.data.session &&
          current.data.session.user.id !== this.previousUserId)
      )
        throw scopeError();
      const { error } = await this.signOut();
      if (error) throw error;
      if ((await this.auth.getSession()).data.session) throw scopeError();
      this.pendingUrl = null;
      await this.exchange(url);
    } catch (error) {
      this.fail(error);
    } finally {
      this.processing = false;
    }
  }
  private async exchange(url: URL) {
    const { hash, code, access, refresh } = recoveryCredentials(
      url,
      this.now(),
    );
    const result = hash
      ? await this.auth.verifyOtp({ token_hash: hash, type: "recovery" })
      : code
        ? await this.auth.exchangeCodeForSession(code)
        : await this.auth.setSession({
            access_token: access!,
            refresh_token: refresh!,
          });
    if (result.error) throw result.error;
    const session = result.data.session;
    if (!session)
      throw new PasswordFlowError(
        "expired",
        "No recovery session was returned. Request a new email.",
      );
    this.recoveryUserId = session.user.id;
    const verified = await this.auth.getUser();
    if (verified.error) throw verified.error;
    if (verified.data.user?.id !== this.recoveryUserId) throw scopeError();
    const expiresAt = Math.min(
      this.now() + RECOVERY_FORM_LIFETIME_MS,
      session.expires_at ? session.expires_at * 1000 : Infinity,
    );
    if (expiresAt <= this.now())
      throw new PasswordFlowError(
        "expired",
        "This reset link has expired. Request a new email.",
      );
    this.pendingUrl = null;
    this.publish({ phase: "ready", userId: this.recoveryUserId, expiresAt });
  }
  private fail(error: unknown) {
    this.pendingUrl = null;
    this.publish({
      phase: "expired",
      message: passwordFlowError(error).message,
    });
  }
  async complete(password: string, confirmation: string) {
    this.expire();
    if (this.saving) return;
    const id = this.recoveryUserId;
    if (!id || this.snapshot.phase !== "ready")
      throw new PasswordFlowError(
        "expired",
        "Request a new reset email before changing your password.",
      );
    this.saving = true;
    try {
      await createPasswordServices(this.auth).change(
        id,
        password,
        confirmation,
      );
      this.publish({
        phase: "signout-required",
        message:
          "Your password was updated. Finish signing out before signing in with the new password.",
      });
      await this.finishSignOut();
    } catch (error) {
      const safe = passwordFlowError(error);
      if (
        this.snapshot.phase === "ready" &&
        ["expired", "account_changed"].includes(safe.code)
      )
        this.fail(safe);
      throw safe;
    } finally {
      this.saving = false;
    }
  }
  async finishSignOut() {
    if (this.snapshot.phase !== "signout-required") return;
    const current = await this.auth.getSession();
    if (
      current.data.session &&
      current.data.session.user.id !== this.recoveryUserId
    )
      throw scopeError();
    if (current.data.session) {
      const { error } = await this.signOut();
      if (error) throw passwordFlowError(error);
    }
    this.recoveryUserId = null;
    this.publish({ phase: "success" });
  }
  async close() {
    if (this.processing || this.saving) return;
    if (this.snapshot.phase === "signout-required") {
      await this.finishSignOut();
      return;
    }
    if (this.recoveryUserId) {
      const current = await this.auth.getSession();
      if (current.data.session?.user.id === this.recoveryUserId) {
        const { error } = await this.auth.signOut({ scope: "local" });
        if (error) throw passwordFlowError(error);
      }
    }
    this.recoveryUserId = null;
    this.pendingUrl = null;
    this.previousUserId = null;
    this.lastUrl = null;
    this.publish({ phase: "idle" });
  }
}
