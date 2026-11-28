# Household invitation controls — 2026-11-27

> Follow-up: invitation protections are now deployed, including legacy eight-character create-code compatibility. New host controls still require the future client release. See the [current rollout record](../release/public-release-readiness-2026-11-27.md); the original audit/deployment notes below are historical.

Implemented in the canonical `main` checkout. Existing uncommitted work was preserved. Applied and tested **only on the isolated local QA backend**. No production migration, purchase, email/invitation delivery, EAS build, or TestFlight submission was performed.

## Rejoining after removal

Removing someone now marks their membership removed, increments its removal version, replaces the shared household code, and revokes outstanding personal invitations and host approvals. Household data access ends immediately through RLS. The removal retains the account and saved household records; existing removal behavior still clears that member's chart approval/preferences and cancels a pending proposal.

A removed account cannot use an old **or current** shared code on its own. The active host can choose either of these options in **Settings → Your household → Invitation controls**:

- **Approve rejoin:** permits that account to use the current household code once within seven days. Approval does not automatically add the person; they still sign in and join.
- **Create invitation:** produces a new personal code, usable only by that removed account within seven days. A subsequent removal invalidates it. Replacing a grant revokes its predecessor.

A removed former host returns as an ordinary member. Replaying a successful request while membership remains active is idempotent; a stored pre-removal receipt cannot report successful admission after access has been revoked.

Hosts can revoke an individual pending approval/invitation, replace the shared code, pause all admissions, or enable admissions with another fresh code. Replacement, pause and resume invalidate outstanding grants. Pausing and individual revocation remain available even after issuance limits are reached. Existing active members keep their access. Host controls cannot be invoked by ordinary, removed, unrelated, or anonymous users.

New shared codes are server-generated 12-character hexadecimal values; personal codes use a full random UUID value without separators. Existing household codes are not all rotated by the migration: each remains usable for ordinary new members until a removal or host action replaces it. Legacy installed clients use the same admission checks, although their error messages may be less specific than the new UI.

## Server abuse controls and invitation storage

- Admission requires an authenticated account with a verified email or phone in the server's Auth record. Expected invalid/expired/revoked/wrong-recipient attempts return a generic unavailable response, without disclosing household names.
- Fixed-window join limits are **10 attempts per 15 minutes and 30 per UTC day per account**, shared across the legacy and current join endpoints. Failed attempts count, and refreshing a session does not reset them.
- Host issuance/rotation/resume uses a shared per-account budget of **30 per hour and 100 per UTC day**. Successful household creation uses the same budget. Server membership limits are **20 active households per account and 50 active members per household**.
- Household and account locks serialize the admission checks and enforce membership caps under concurrent requests. A queued join cannot bypass a removal or code rotation that wins the household lock.
- Private invitation/counter tables have RLS enabled and no ordinary-client table permissions. Removed members cannot alter their frozen profile to mislead the host. Host listing returns recipient metadata and the code's final four characters, never the personal code or its verifier.
- The client submits a SHA-256 proof; the server stores a second SHA-256 verifier. A stored verifier cannot itself be replayed as a valid submitted proof. The raw personal code is displayed transiently on the issuing screen and is not placed in analytics, the server receipt, or the pending-operation journal. The proof in a pending request is still sensitive capability material and remains account-scoped. Losing the raw code requires replacing it rather than recovering it from the server. Shared codes remain readable by active members for sharing, as before.
- Counters use account IDs only: **no new IP, IP-hash, device, or location tracking**. Old counter windows are pruned when that account next uses the budget; inactive accounts can retain their last windows until further activity or account deletion. Grants are retained as revocation/usage metadata, with household/account deletion cascades.

The design uses account-bound throttling and generic denials consistent with the [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). These controls reduce invitation abuse; they are not a claim of complete abuse prevention.

Expected admission failures commit their counters rather than raising SQL exceptions, which would roll back those increments. Admission RPCs are forbidden inside mutation batches so a later failed statement cannot erase a guessing attempt. The legacy RPC returns an HTTP denial using `response.status` while allowing counters to commit. The local server also rejected attempts to erase counters with `Prefer: tx=rollback`; transaction-end overrides must remain disabled in deployment. See [PostgREST transactions](https://docs.postgrest.org/en/v12/references/transactions.html).

## Verification and evidence

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Full mobile test suite | **112/112 programs passed** |
| Actual local Auth/PostgREST/RLS invitation audit | **14 groups passed** |
| Existing durable-save process-termination regression | **82 mutation cases passed**, including join/rejoin/removal |
| Local Expo exports | Web, iOS, and Android JavaScript bundles passed |
| Narrow browser layout | Viewport and document width both 390px; action controls 52px high; no horizontal overflow |
| Cleanup | Zero disposable invitation/visual/termination accounts remain; task preview and its private fixture/demo bundle removed |

The server audit exercised removal and immediate data denial, the current-code rejoin block, host-only approval, account-bound personal invitations, stored-verifier replay rejection, expiry/revocation, former-host role downgrade, concurrent redemption/removal, private-table access denial, frozen member identity, failed-attempt persistence, daily limits across refreshed sessions, rollback/batch attempts, idempotent issuance, stale admission receipts, emergency revocation after quota exhaustion, verified-account checks, record preservation and transactional membership-cap fixtures.

The actual component tests cover issuance with a proof rather than raw code, approval, copy, revoke, pause/Cancel/enable, request locks, errors, and hiding personal codes across account/household changes. Membership-refresh tests execute the actual context callbacks and ensure denials or account switches do not become local join successes.

Visual testing used only disposable Host QA / Removed QA accounts. The browser exercised expanding the panel, creating an invitation, approving rejoin, revoking a grant, cancelling a pause, and confirming a pause. It caught and fixed unreadable destructive-button text and a metadata refresh that unmounted the issuing screen before its personal code could be copied. Background metadata updates now preserve the settings panel while initial/new-account loads still gate correctly. Copy was exercised in the component test without overwriting the user's real clipboard. No invitation was sent to another person.

- [Server results](household-invitations-2026-11-27/server-tests.txt)
- [Process-termination regression](household-invitations-2026-11-27/termination-regression.txt)
- [Workspace typecheck](household-invitations-2026-11-27/typecheck.txt)
- [Check summary](household-invitations-2026-11-27/checks.txt)
- [Personal invitation screenshot](household-invitations-2026-11-27/personal-invitation.jpg) — disposable, now-inert code only
- [Paused invitations screenshot](household-invitations-2026-11-27/invitations-paused.jpg)

## Source and deployment requirements

The main change is `supabase/migrations/202611270002_household_invitation_controls.sql`. The still-unreleased `202611270001_durable_app_operations.sql` also includes the new RPC allowlist, admission batch exclusion and receipt membership recheck. Both were updated/applied locally; they are not production history that has been rewritten.

The app uses the existing singleton Supabase client and durable transport. Main client changes are `components/HouseholdInvitationControls.tsx`, `components/InviteCodeCard.tsx`, `lib/householdInvitations.ts`, `lib/durableMutationFetch.ts`, `context/AppContext.tsx`, and the settings/onboarding entry points in `artifacts/mobile`. Tests include `lib/householdInvitationControls.test.ts`, `lib/householdInvitations.test.ts`, `lib/invitationRefresh.test.ts`, and `scripts/reliability/test-household-invitations.mjs`.

Before a separately authorized deployment, inventory the production schema/configuration and back up the database. Apply the pending reliability migrations in order, including the reviewed versions of **202611270001 and 202611270002**, and confirm transaction-end overrides remain disabled. The backend restrictions protect old clients once deployed; the new host controls and improved join messages require a separately authorized app update. Re-run production-safe authorization checks and native-device checks after deployment. No installed phone build was changed here.

## Limits

- Browser and bundle checks do not exercise a physical iPhone/Android app, native clipboard/share UI, native storage, offline-to-online recovery, OS force-quit timing, VoiceOver, or every appearance/text-size setting. These still need device verification.
- The tests cover the described actor and mutation matrix, not every possible input/timing interleaving or every other app feature. They are not a penetration-test certificate.
- Removal is tied to the authenticated account. It cannot recognize the same person using a different/deleted-and-recreated account, prevent coordinated verified-account farming, or replace infrastructure-level denial-of-service protection. Account-only throttling intentionally avoids IP/location collection.
- The short counter windows are fixed UTC windows, not sliding windows. Limits and the 50-member/20-household caps are explicit policy choices that can be reviewed against real usage.
- Client proof material in a pending join/issue operation remains sensitive. The broader native credential-storage improvement in the security plan is still separate work.
- Approval does not send a push/email or automatically restore access; the host shares the code through the existing sharing flow. Production email delivery, external sharing, provider configuration and production policies were not changed or verified in this task.
