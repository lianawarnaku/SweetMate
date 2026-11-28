# Release hardening — November 27, 2026

The owner approved implementing the release-readiness plan. Purchases and new
native/TestFlight builds remain prohibited until a separate explicit release
request. This report distinguishes code, deployed configuration and actual-device
acceptance; it is not a security certification.

## Implemented

- Native Supabase auth persistence uses AES-256-GCM, random nonces and storage-key
  authenticated data. Only the small encryption key enters Expo SecureStore with
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY; larger encrypted session values
  remain in AsyncStorage. Web retains browser persistence. The operation journal
  stays separate and never receives auth headers or session tokens.
- A first native read migrates the existing SDK storage key: write and reread the
  vault key, encrypt/decrypt-verify, commit and reread ciphertext, then remove
  plaintext. Interrupted cleanup finishes on the next read. There is no plaintext
  fallback after a secure value exists. Temporary vault errors preserve data and
  fail closed. A missing key after backup restoration requires a new sign-in.
- Per-key serialization prevents refresh/signout/switch writes overtaking each
  other. Logout commits a tombstone before deleting legacy values and the key.
  An iOS key surviving uninstall cannot restore a session without its ciphertext.
- Signup and password changes share the 12–128-character validation module.
  Existing sign-in passwords are still sent unchanged to Auth. Production's
  minimum password length was saved as 12 and verified by reopening Email settings.
  Secure email/password change and current-password requirements remained on.
- New Calendar connections request calendar.events.readonly plus
  calendar.events.owned, calendar.calendarlist.readonly and tasks.readonly.
  Exports remain explicitly directed to the user's primary calendar. Backend
  validation accepts the new combination and existing broad grants, trusts the
  Google token response rather than a supplied scope string, and verifies the
  Google subject belongs to the authenticated SweetMate account.
- The legacy create_household RPC still honors valid caller-generated 8-hex codes
  because build 54 displays its proposed code without reading the response.
  New clients send an empty code and display the server-generated 12-hex code.
  Both paths retain the same admission limits and removed-member protections.
  Collisions fail rather than returning a different code to an old client.
- Migration 202611270003 additionally revokes all ordinary-client privileges on
  google_calendar_connections while retaining RLS and service-role access.

## Verified live state

Google project homie-502522: SweetMate name/logo, sweetmate.info homepage and
privacy URL, existing working OAuth client/callback preserved. Data Access changes
were saved: identity, calendar-list reading, event reading, owned-event writing,
Tasks reading, and temporary legacy calendar.events for installed clients.
Verification Center explicitly still reports Testing. No review was submitted.

Pre-rollout production inventory: latest migration 202611260003; 16 households, 20 active
memberships, 20 users; zero users lack the server confirmation timestamp.
Google token table: RLS true, zero policies; client table grants were present
before the additional hardening migration. These grants alone did not bypass RLS.
Email confirmation was initially off. After the owner confirmed delivery of the
approved recovery test email, Confirm email was enabled and saved. A separate
public Auth settings request verifies mailer_autoconfirm=false. New email/password
accounts must confirm ownership before first sign-in; old confirmed accounts remain valid.

A single owner-approved recovery email request was accepted and the owner confirmed
inbox delivery. The reset link was not consumed; no password or account was changed.
The owner enrolled Supabase administrator MFA. The Security page then showed the
new authenticator and available recovery codes; secret values were never viewed.
Other infrastructure accounts and MFA methods still need their own access review.

## Backup and rollout

Private production schema/data dumps are outside Git under
Downloads/SweetMate-release-backups/2026-11-27-security, directory mode 0700,
files 0600. Never publish, attach or commit these dumps: they include private app
and authentication records. Schema SHA-256:
9e75ccb616676309137ac6712102ce7bb5c378abb361c177ad5591eaa994ac49;
data SHA-256:
2ed9ba376e6b9321f2069869bcc55df6673daa7a4403c43cf6406f68a3f73334.
The Free project has no scheduled backups. The isolated restore drill passed using the exact production Auth schema plus app
schema/data: all 16 households, 20 active memberships and 20 accounts recovered.
It ran in a separate database, with triggers disabled and no API connection or
background scheduler. The temporary database was removed. The normal QA database
was untouched. This does not back up Storage objects, managed platform settings,
Edge secret values or live scheduler configuration; it is not a full-platform
disaster-recovery certification.

Committed backend migrations: 9f894cb. The reviewed dry run and actual rollout
contained only 202611260004/005/006 and 202611270001/002/003. All six are deployed.
A fresh migration inventory has no pending versions; latest production version
is 202611270003. Post-rollout SQL verified 16 households, 20 active memberships
and 20 accounts remain. Anonymous/authenticated Google-token privileges are false;
service-role privileges remain true. A real anonymous REST read is rejected (401).
The CLI reported a local pg-delta catalog-cache certificate-path warning after
applying migrations; independent server history and privilege checks succeeded. Prefer
forward repair over weakening admission rules or deleting operation receipts.

## Tests and remaining limits

Final app checks: **116/116 test programs** and all workspace type checks passed,
including the real-handler Google grant/identity and protected-storage tests. The actual
local invitation audit passed 14 groups, including an old-client displayed-code
join. Direct local SQL proves anonymous/authenticated credential reads and writes
fail while service-role privileges remain. Final checks also include **11 local SQL suites**, **14 invitation groups**,
**7 Deno tests** and **19 website tests**. Sequential iOS, Android and web
JavaScript exports all passed; these are packaging checks using dummy QA public
configuration, not distributable native builds or uploads. The combined export
was stopped after stalling; isolated single-platform runs completed normally.

Native storage tests execute the actual adapter against a Node AES-GCM bridge:
large Unicode values, random nonce, context binding/tamper rejection, restart
recovery at migration failures, locked vault, key loss, signout interruption,
serialization and uninstall behavior. They do not exercise iOS Keychain, Android
Keystore, biometrics, device backup restoration or a real native process kill.

Still required: real phone acceptance and a fresh signup-confirmation round trip,
remaining provider/admin access reviews, Apple credential expiry/revocation checks,
vendor retention/erasure demonstration, Google video/review/outside-test-account
connection, and the separately authorized native release and store submission.
Keep existing analytics history and the item-name analytics gate disabled.

## Dependency and service validation

The captured initial workspace audit reported 13 critical/65 high findings;
compatible patches removed the critical and high findings. Applied fixes
include Vite >=7.3.7, Zod >=4.6.6 and decode-uri-component >=0.5.1. Older query-string
uses a CommonJS callable; a tiny private workspace adapter bridges the patched
upstream ESM module. Actual router parsing tests cover Unicode, OAuth parameters,
normal serialization and long malformed percent input. Expo/React Native versions
and the one-day package release-age protection remain unchanged.

Edge Function Deno tests passed 7/7 against the new exact Zod pin and official
registry integrity. Website rendered-page tests passed 10/10 and static/auth tests passed 9/9 after patches; no
framework server is deployed, only static Pages output and the existing isolated
confirmation script. All workspace type checks passed after the final dependency changes. The real
Expo router query-string compatibility test passed. The two relevant Edge Functions
(calendar and submit-feedback) are deployed; feedback required the explicit
function import map, now recorded in config.toml. A failed bundle upload did not
publish a replacement; the corrected upload succeeded.

Operational transition: installed build 54 does not include the new host invitation
controls or native storage/UI changes. Removed-member rejoining now requires fresh
host approval/personal invitation on the updated client; ordinary fresh joins keep
working with the legacy code format. Do not weaken admission to compensate for an
old UI; complete the separately authorized candidate and phone acceptance.

The analytics console became unresponsive during the remaining vendor review.
No retention setting or historical analytics was changed, and no vendor erasure
was performed. Item-name analytics remains release-gated.

### Final advisory snapshot

The official npm bulk advisory endpoint was checked against 919 public dependency
package names in the final lockfile: **0 critical, 0 high, 8 moderate, 2 low**
package/advisory matches. This uses package-version matches, whereas pnpm's initial
summary includes its own finding/counting model. The normal final pnpm audit stalled;
the bounded direct check uses the same official registry advisory source.

Remaining findings concern fast-copy 4.0.2 (deep-copy depth), minimatch 10.2.6
(glob complexity), qs 6.15.0 (four query/stringification cases), uuid 3.4.0
(caller-provided buffers), yaml 2.8.2 (nesting), @babel/core 7.29.0 (source-map
comments), and esbuild 0.27.3 (Windows development-server file access). Review
these contexts before exposing the legacy Node API or processing untrusted
build/config inputs. They were not suppressed or represented as fixed. No
dependency audit proves the absence of vulnerabilities.

The production Calendar and feedback functions run from the tested source in
commit 1f40495; feedback additionally uses the explicit import-map deployment
configuration. Existing Google credentials and provider callbacks are unchanged.


## Final artifacts and delivery boundary — November 28

App code is committed on main in **23f9d08**, Calendar changes in **1f40495**,
backend migrations in **9f894cb**, and website maintenance in **93b70cf**.
No native release build, OTA update, TestFlight upload, store submission or purchase
was made. Installed build 54 does not gain the new client behavior from these commits.
The detailed current status is in the [release readiness record](../release/public-release-readiness-2026-11-27.md).

The patched Orval generator produced seven artifacts in a temporary directory;
checked-in generated sources were preserved. Moving output outside the workspace
caused its React Query package-location warning, so this is a generator smoke
check, not certification of regenerated client API types.

The website's final separate lockfile was checked against the same official
registry: **0 critical, 0 high, 1 moderate and 1 low** package/advisory match across
609 names. The normal install summary counted seven affected graph entries
(five low, two moderate); these counting models differ. Remaining website contexts
are fflate's malformed-ZIP64 unzipSync and esbuild's Windows development server.
The deployed website is static and does not execute those build-time packages.
No content/auth-effect change was made by the dependency patch, so the already
verified live static publication was retained rather than republished needlessly.

Sanitized committed evidence: [verification summary](release-hardening-2026-11-27/verification-summary.json),
[platform exports](release-hardening-2026-11-27/platform-exports.json),
[anonymous function checks](release-hardening-2026-11-27/production-function-checks.json),
[workspace advisories](release-hardening-2026-11-27/dependency-advisories.json),
[website advisories](release-hardening-2026-11-27/website-dependency-advisories.json),
and [source secret scan](release-hardening-2026-11-27/secret-scan.json).
Screenshots are local-only review evidence because full browser captures may
contain unrelated tab titles. Raw production backups and credentials stay outside Git.
