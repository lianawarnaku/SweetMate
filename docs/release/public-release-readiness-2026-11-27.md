# SweetMate public-release readiness

Updated November 28, 2026 for the owner-approved implementation plan. Work is on
canonical **main**. The app and backend work is committed; production backend
changes below are deployed. **The app is not yet ready for public submission.**
No purchase, native release build, OTA update, TestFlight distribution or public
store submission was performed. Installed build 54 is unchanged.

November 28 follow-up: the privacy policy publishes verified PostHog US/Free
one-year retention and the currently inactive Sentry configuration. All 19 website
checks and public HTTP checks passed. PostHog owner/access/replay/location/export
checks are complete, owner MFA is verified enabled, and the corrected DPA is
**Signed**. Google is now **External / In production** after owner action-time
approval. Verification is still unsubmitted: the automated logo finding requires
manual review and the combined form requires a real YouTube demo. The owner has
deferred that video; a private Calendar reminder is confirmed for November 29 at
10:00 AM Eastern. The synthetic erasure request was accepted and the profile now
returns 404; final event purge remains asynchronous. Real analytics history stays
intact.
See the [current vendor execution record](../privacy/vendor-review-2026-11-28.md).

## Current status

| Workstream | Completed and verified | Still required |
| --- | --- | --- |
| Public website | Free Cloudflare Pages hosting; privacy, support and account-deletion pages live; homepage/auth confirmation preserved; email DNS preserved | Monitored support handling and actual native confirmation/deletion acceptance |
| Authentication | Protected native-session adapter and migration; shared 12–128 password policy; real recovery and secure changes; production minimum 12 and email confirmation on; owner received test recovery email and enrolled Supabase administrator MFA | Native Keychain/Keystore behavior, upgrade/refresh/logout/account switch, genuine signup confirmation, hosted reset and device callback tests; remaining infrastructure MFA/access review |
| Household/data security | Six migrations deployed through 202611270003; invitation revocation/rejoin approval/rate limits; durable duplicate-safe operations; stale-chart and membership guards; Google credential table denied to ordinary clients | Real-device removal/rejoin and offline/termination acceptance; transition to new host invitation controls; score-concurrency limitation below |
| Google access | Existing credentials/callback preserved; narrower new Calendar scopes in code/console; compatible backend deployed; scope/identity tests and submission script ready; both APIs enabled; Production audience verified | Live Tasks/consent flow and real demo video, legacy-scope rollout, branding appeal/scope review and an account outside the test list |
| Dependencies | Compatible patches; workspace and website scans show no critical/high matches in reviewed lockfiles | 8 moderate/2 low workspace matches and 1 moderate/1 low website match remain; review actual contexts, do not suppress or call them eliminated |
| App fixes and local testing | Recovery, pagination, durable retry, invitations, black content surfaces and prior calendar/UI fixes committed; all final checks below passed | Physical iPhone acceptance of actual candidate; native storage/haptics/gestures/accessibility and external providers are not certified by browser personas |
| Privacy and store preparation | Live policy, privacy worksheets, Google demonstration script, App Store submission checklist and phone checklist prepared; item-name analytics remains off | Remaining vendor access/retention/erasure and Apple credential review; matching final privacy labels, screenshots, reviewer login check and submission |

## Deployment and preservation

Production changed only after private schema/data backups and an isolated restore
of the production Auth/app schemas. The temporary restore database was removed.
Counts stayed **16 households, 20 active memberships, 20 accounts** before and after
rollout. Credential-table RLS remains enabled; anonymous/authenticated table
privileges are revoked; service-role access remains available. Both updated
Calendar and feedback endpoints reject unauthenticated requests (401).

The free Supabase project has no scheduled backups. The local dump/restore drill
covers database records, not Storage objects, managed settings, Edge secrets,
schedulers or a live Auth recovery exercise. Private backup files are outside Git
with restricted permissions. A repeatable manual backup schedule and full-service
recovery procedure remain operational work; no paid upgrade was purchased.

Installed build 54 can still create/join using its displayed 8-character code;
new code uses the returned server-generated 12-character code. Removed accounts
now need fresh account-bound approval/personal invitation. The new host controls
require the future client update; do not weaken server admission for the old UI.

## Final local verification

| Check | Result |
| --- | --- |
| Workspace typechecks | Passed |
| Mobile test programs | 117/117 passed after integrating remote main |
| Local Auth/RLS/RPC invitation audit | 14 groups passed |
| Local SQL policy/business-rule suites | 11 passed |
| Deno feedback tests using patched import map | 7/7 passed |
| Website rendered plus static/auth tests | 10 + 9 passed |
| iOS, Android and web JavaScript exports | All passed, using dummy QA public configuration; no native compilation/upload |
| Generator smoke test | Seven temporary artifacts; tracked generated files preserved; output relocation warning limits this check |
| Official npm advisory checks | 0 critical/high in both reviewed lockfiles; lower-severity matches retained in evidence |
| Source secret scan | No candidates in 174 reviewed changed/untracked text files; not a full historical/binary secret audit |
| Production-safe endpoint probes | Anonymous Calendar/feedback denied; zero mutations |

Earlier audits separately exercised **82 mutation process-kill cases plus three
provider-model cases**, and pagination beyond the verified **1000-row** production
cap using **1257-row** local fixtures. Those are prior audit results, not additional
physical-device tests or a claim they were rerun in this final export pass.

Duplicate-safe operation replay is not a transactional score ledger: independent
concurrent household score snapshots can still race. Separate web tabs also do
not share a cross-tab transactional outbox. Device storage failure, uninstall or
termination before a journal write finishes cannot guarantee unsent work survives.
These limits remain explicit in the [durable-save audit](../qa/durable-saves-2026-11-27.md).

## Remaining sequence

1. Finish vendor administrator/access, retention and authorized dummy-identifier
   erasure checks; verify Apple credential expiry/revocation and log handling.
   Retain historical PostHog analytics as requested. The temporary unresponsive
   PostHog tab was closed by the owner; no retention/history change was made.
2. Obtain the owner's separate release request, then package the committed main
   candidate. Do not build/upload TestFlight merely because this report exists.
3. Complete the [real-phone acceptance sheet](phone-acceptance-2026-11-27.md),
   fix failures and record exact device/build evidence before submission. Test
   Calendar/Tasks on real Google accounts, including cancellation/partial grants.
4. Record the actual native demonstration, retire or justify the legacy scope,
   complete [Google production/verification](google-verification-submission-2026-11-27.md),
   and verify an account outside the test-user list. Google's review is external;
   the audience is In production, but scope verification and unrestricted access remain incomplete.
5. Reconcile the accepted build with [App Store preparation](app-store-submission-2026-11-27.md),
   finalize screenshots/disclosures/reviewer login, then perform the separately
   authorized submission. Keep item-name analytics disabled until its own consent,
   vendor and store gates pass. Paid branded auth and Android launch can wait.

## Evidence and commits

- Backend migrations: **9f894cb**.
- Narrow Google grant handling and server validation: **1f40495**.
- App/security/reliability/dependency changes: **23f9d08**.
- Cloudflare website workflow and dependency maintenance: **93b70cf**.
- [Hardening details and sanitized machine evidence](../qa/release-hardening-2026-11-27.md).
- [Live website publication and preservation evidence](../qa/website-publication-2026-11-27.md).

The patches and local checks reduce known risk. They do not establish that every
button, account state, network timing, OS version or third-party service is bug-free.


### Final integration check

GitHub main also contained quick-add commits **38ba72c** and **c07cf4f**. They were
merged without a force push, preserving the tap-to-add and long-press menu behavior.
The import conflict retained both stable shopping draft IDs and navigation hooks.
A real effect-order regression reproduced the shopping form being immediately
closed on first mount; navigation handling now follows account/household cleanup.
The borrowing editor test also exercises the new route. All **117 app test
programs**, workspace types and fresh iOS/Android/web JavaScript exports passed
on the combined source. These checks do not claim native visual/device acceptance.
