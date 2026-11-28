# Email recovery and password changes — November 27, 2026

> Follow-up: signup and recovery now share 12–128-character validation; production confirmation is enabled and the owner confirmed one recovery email arrived. No reset was consumed. Code is committed, but native acceptance remains pending. See the [current release record](../release/public-release-readiness-2026-11-27.md).

Implemented on the canonical `main` checkout. Existing uncommitted changes were
preserved. No purchase, commit, push, database migration deployment, EAS build,
TestFlight upload or distribution was performed.

## Result

- **Forgot password?** on the real sign-in screen sends a genuine Supabase Auth
  recovery email. Settings also offers email recovery from Account security.
  Success copy does not reveal whether the address has an account.
- A dedicated `auth/reset-password` callback handles initial launch and warm URL
  events before normal sign-in, household setup or analytics screens can take
  over. Recovery material stays in memory; callback query/fragment material is
  removed from the web address. Ordinary Google/Apple callbacks are unchanged.
- Invalid, incomplete, expired and already-used links offer another recovery
  email and a Back button. Accepted forms expire after at most 15 minutes or
  their earlier session expiry. Duplicate delivery cannot consume a link twice.
- Opening a link while signed in asks before signing out. Cancel preserves the
  original session. Account changes during recovery or saving stop the operation.
- Recovery uses real Auth verification and password update APIs. Settings changes
  first verify the current password with real password sign-in and also send
  `current_password` to Auth. Email security-code reauthentication is supported
  when required by the server. New passwords require 12–128 characters and a
  matching confirmation; existing users can still sign in with older passwords.
- Password fields are masked and support password-manager autofill. Inputs and
  secondary actions lock during submission. Errors are fixed safe messages,
  without raw provider responses, credentials, tokens or recovery URLs in logs.
- Successful changes sign out existing sessions and return to sign-in. If logout
  fails after the password saves, the screen retries logout without saving again.
  Cancelling recovery signs out only its temporary session.
- Removed the obsolete device-only username/password setup, local hash helper,
  simulated email/code reset screens, their unused `/api/email/send` relay and
  unused local identity-switch API. The relay's demo response and arbitrary email
  sender are no longer mounted in the source API server.
  Supabase remains the identity source. Old inert local hashes are not migrated
  into cloud credentials or used for authentication; no device storage or real
  household records were purged.

## Production configuration applied

In Supabase project `eqnogaftebuqfwwelbdx`:

- Enabled and saved **Secure password change** and **Require current password
  when updating**. Both checked states were read back in the Email provider UI.
- Kept the existing one-hour email token expiry, sign-up confirmation setting
  and existing minimum password setting. This task does not claim to finish the
  separate sign-up/email-verification/security-policy work.
- Confirmed the existing `sweetmate://**` redirect allowance already covers the
  native reset callback. No production redirect rules were broadened.
- Confirmed existing custom SMTP through Resend. Kept its address, credentials,
  host and port; saved and reloaded the sender name as **SweetMate**.
- Saved and reloaded **Reset your SweetMate password** as the reset-email subject,
  with SweetMate copy, the real `{{ .ConfirmationURL }}`, single-use/expiry help
  and instructions for an unsolicited email. No production reset email or real
  user's password was used for testing.

The local QA redirect allowlist includes the reset paths on ports 4173–4175 and
the native scheme. Local secure password change was enabled without resetting
the database. The older local Auth version does not expose the hosted
current-password toggle, so the app independently proves the current password
with genuine password sign-in; production also enforces its own toggle.

## Verification

| Check | Observed result |
| --- | --- |
| `pnpm run typecheck` | Passed across the required workspace projects. |
| `pnpm --filter @workspace/mobile run test` | **100/100 passed**. |
| `node scripts/accounts/test-password-recovery.mjs` | Seven actual local Auth/Mailpit/database scenarios passed; disposable users cleaned up. |
| Expo export for web, iOS and Android | All three bundle exports passed; this is not a native device build or TestFlight release. |
| Browser sign-in recovery | Forgot password opens recovery; invalid email shows an inline error; Back returns to sign-in. |
| Browser actual recovery token | Auth verification opens New password/Confirm; Cancel signs out the temporary recovery session; reuse shows unavailable and allows a new email. No new password was entered through the browser. |
| Browser Settings | One Account security card; Change password opens three masked fields; Save is disabled until fields are entered; Cancel closes the form. |
| JSX sibling-key regression | The visual pass found a duplicate key shared with Feedback, causing repeated security cards. The test was extended to cover ternaries, reproduced the failure, and passed with the unique security key. Reloaded browser showed one card. |
| API-server typecheck and existing test | Passed after removing the obsolete email relay. |
| `git diff --check` | Passed. |

The actual Auth integration creates two disposable users and a household with a
saved list. It proves a wrong current password fails; a genuine current-password
change rejects the old password and old refresh session; a real recovery email
arrives in local Mailpit; its verification URL redirects to the exact callback;
resetting allows the new password for the same account ID; reused email links
and actual expired server tokens fail; token-hash verification is single-use;
and both active roommates and the saved list survive unchanged. It rejects any
non-loopback backend before running. Cleanup deletes only the users it created.

Service/controller and form regressions cover malformed callbacks, PKCE errors,
expired forms, account switching, safe errors, weak/mismatched passwords,
duplicate submissions, reauthentication codes, recoverable network failures,
and password-saved/logout-failed retry. A rejected recovery session during Save
returns to the new-email screen rather than leaving a stuck password form.

Temporary preview servers and the disposable visual account were removed after
testing. Existing Avery, Blake and other audit households were preserved.

## Limits and rollout

- The app changes are ready in source, **not installed in the current phone
  build**. A separately authorized native build and device check are still needed.
  The removed legacy API relay also requires the normal API deployment to affect
  any separately hosted instance; no API deployment was performed here.
- Browser recovery screens were checked at a 390 × 844 viewport; the valid-reset
  form and Settings were also checked at the browser's approximately 787-pixel
  width. This does not verify native keyboard, VoiceOver or Dynamic Type.
- Production SMTP is configured, but live inbox delivery, spam placement,
  provider quotas, email link-scanner behavior and deliverability were not tested.
  No production account was modified or used for a real reset.
- A physical iPhone/Android cold launch from Mail/Gmail, warm deep links and
  platform password-manager autofill remain unverified. Expo Go has a separate
  redirect scheme/allowlist; only standalone native and local web reset paths
  were prepared here.
- The integration exercised the installed local Auth version. The newer hosted
  current-password toggle was verified as enabled, not tested by changing a real
  production user's password. Unit/form tests exercise nonce handling; an actual
  24-hour-old hosted session requiring an emailed nonce was not tested.
- Supabase revokes refresh sessions on logout/password change. Already-issued
  access JWTs may remain valid until expiry; no claim of instant JWT revocation
  or elimination of all account-security risk is made.
- OS-protected session storage, invitation abuse controls, infrastructure MFA,
  email-confirmation policy and broader security-plan items remain separate work.

Before the next authorized release, test a disposable account on a real phone:
request a reset, open it with the app closed and already open, change its password,
verify the old password fails, test used/expired links and Settings' wrong-current
password error, then confirm household data and normal Google/Apple login remain.

## Visual evidence

![Recovery email form](password-recovery-2026-11-27/reset-email.jpg)

![Invalid link offers a new email](password-recovery-2026-11-27/invalid-link.jpg)

![Actual recovery token opens the new-password form](password-recovery-2026-11-27/new-password.jpg)

![Settings requires the current password](password-recovery-2026-11-27/change-password.jpg)

![Saved production reset-email template](password-recovery-2026-11-27/production-email-template.jpg)

Reference: [Supabase password guidance](https://supabase.com/docs/guides/auth/passwords),
[reset email API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[password update API](https://supabase.com/docs/reference/javascript/auth-updateuser),
[password security](https://supabase.com/docs/guides/auth/password-security).
