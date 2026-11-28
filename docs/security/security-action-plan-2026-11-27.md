# SweetMate security action plan

Execution status updated November 28, 2026. The owner approved implementing the
release-readiness plan. This is source, local-test and production-configuration
evidence, not a penetration-test certificate or a promise that all risk is gone.
See the [current release record](../release/public-release-readiness-2026-11-27.md)
and [detailed evidence](../qa/release-hardening-2026-11-27.md).

## Implemented protections and remaining acceptance

| Priority | Implemented | Remaining evidence/action |
| --- | --- | --- |
| Household admission | Production fresh account-bound host approval/personal invitations after removal; revocation/rotation/pause, verified accounts, per-account throttling and caps | Real-device host/member flow; the new invitation UI needs the future app update. Old shared code alone cannot readmit a removed account. |
| Native sessions | AES-256-GCM ciphertext in AsyncStorage, small key in OS-protected SecureStore; verified migration, serialization and logout tombstones; actual adapter tests pass | Real Keychain/Keystore upgrade, lock/refresh, signout, account switch, reinstall/backup and deep-link acceptance. Web persistence retains its browser threat model. |
| Email/password | Genuine recovery and secure password change in code; obsolete fake local-account flow removed; shared 12–128 validation; production minimum 12 and confirmation enabled | Native confirmation/reset round trips, used/expired/cancelled links and older-password sign-in. Owner confirmed one production recovery email arrived; no reset was consumed. |
| Google credentials | Backend validates Auth user and Google subject; trusts refreshed token scopes; narrow new grants plus legacy compatibility; RLS plus revoked client grants deployed | Real provider refresh/revoke/disconnect/deletion outages and partial-grant acceptance; consider recoverable application-level token encryption and key rotation. |
| Mutation reliability | Durable account-scoped operations and duplicate-safe receipts deployed; stale chart, owner exit and membership revocation protections deployed | Physical offline/force-quit/two-device acceptance. Independent household score snapshots can race; replay protection is not a transactional score ledger. |
| Administrators/backups | Owner enrolled Supabase administrator MFA; private database backup and separate restore drill passed before rollout; records preserved | Other provider admins/access/MFA and Apple credential expiry/revocation; repeatable manual backups and full service-recovery drill. Free project has no scheduled backups. |
| Dependencies | Compatible workspace and website fixes; final reviewed lockfiles have zero critical/high advisory matches | Remaining moderate/low findings and untrusted-input contexts are documented, not suppressed. Repeat checks before the actual release. |
| Telemetry/privacy | New PostHog IP/GeoIP enrichment disabled and incoming geographic metadata filtered; historical analytics retained by request; optional consent/default minimization; name gate off | Vendor retention/access/erasure, operational logs, native no-consent network verification and matching final store declarations. Do not enable name sharing prematurely. |
| Delivery | Backend migrations through 202611270003 and Calendar/feedback updates deployed; app code committed on main | Separate owner authorization for native release, then actual phone acceptance, Google verification and App Store submission. |

## Existing protections to preserve

- Membership role/status updates are revoked from ordinary clients; direct profile
  writes are limited, and household RLS requires active membership.
- Calendar and deletion handlers validate bearer tokens with auth.getUser before
  scoped operations. Schedule workers use a separate worker secret. Gateway
  verify_jwt=false or wildcard CORS alone does not establish anonymous access.
- Public Supabase project keys are expected client configuration. They are not
  privileged service-role credentials; those stay on the backend.
- Journals exclude passwords, OAuth/session tokens and Authorization headers.
  Account switching and consent are isolated; rejected admission is not treated
  as local success. Acknowledged receipts prevent duplicate replay, not unrelated
  concurrent business-action conflicts.
- Negative SQL/API tests cover anonymous, ordinary, unrelated and removed actors.
  Only disposable local fixtures are used for destructive test scenarios.

## Open operational actions

1. Complete the provider access/retention review and authorized deletion drill
   with dummy identifiers, retaining real historical analytics as requested.
2. Verify Apple provider credentials/revocation and full backup/service recovery.
3. Obtain the separate release request and execute the physical-device checklist;
   resolve failures and the independent score-concurrency limitation before
   promising fully concurrent points accounting.
4. Complete public Google review and reconcile privacy/store materials with the
   actual accepted candidate. No build, purchase or submission is implied by this file.

Sources: [Supabase production checklist](https://supabase.com/docs/guides/security/production-checklist),
[React Native auth quickstart](https://supabase.com/docs/guides/auth/quickstarts/react-native),
[Supabase sessions](https://supabase.com/docs/guides/auth/sessions),
[password security](https://supabase.com/docs/guides/auth/password-security),
[Apple protecting user privacy](https://developer.apple.com/design/human-interface-guidelines/privacy).
