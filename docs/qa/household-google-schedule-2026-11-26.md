# Household-specific Google schedule setup

## Fix

My Sweet hid its connection link using only the signed-in person's account-wide OAuth state. Personal schedule preferences were also keyed only by the person. Switching households therefore inherited the previous household's selected sources, ready flag and enabled state.

Each household now has its own private calendar/task-list selections, timezone and setup status. A new household has no configured schedule and displays **Connect your Google schedule**, even when the person already authorized Google in another household. Its picker starts with no sources selected and busy sharing off. Saving this household's choices hides its Home link; management stays in Settings. Returning to another household restores that household's selections. Valid personal Google authorization is reused; this does not require repeatedly granting Google consent.

Settings distinguishes “Not connected in this household,” “Connected in this household,” and paused imports. Its Connect entry opens the same picker. The existing account-wide disconnect is explicitly labeled “Disconnect Google account everywhere.” Pausing imports in the picker affects only the selected household.

## Data and compatibility

`202611260001_household_schedule_setup.sql` adds owner-readable `member_schedule_preferences`, keyed by household and person. Writes require active membership through `configure_household_schedule`; roommates cannot read each other's calendar IDs. Busy-only activity respects the sender's selections in that household.

The existing background worker and personal imported-item cache remain personal. Its sync preferences contain the union of enabled household sources. Configuring/pausing one household retains another household's chosen sources and imported items. Imported event/task completion and local time overrides remain personal, rather than making separate copies of the same Google item for each household.

Existing setups are backfilled only into previously configured households identified by saved sharing records, including sharing-off records. For legacy configurations without sharing rows, only the original active membership is used. New memberships are never automatically opted in. The previous RPC signatures remain available for installed clients.

Household switches synchronously hide the old household's preferences/items. Late reads and stale picker callbacks cannot restore or configure a different household. Calendar day sync keys also include household identity.

## Verification

- Workspace `pnpm run typecheck`: passed.
- Full mobile suite (77 test programs): passed, including extended runtime tests for fresh-household connection entry, independent source choices, returning to the original household, stale reads/pickers and immediate switch isolation.
- Local web and iOS/Hermes exports: passed; no EAS release build.
- Transactional migration rehearsal: original setup preserved, sharing-off setup preserved, newly joined household not backfilled, legacy fallback limited to original membership. Rehearsal rolled back.
- Added `supabase/tests/household_schedule.sql`: source unions, stale sync leases, independent setup/timezones, cache preservation, pausing imports, fresh households, input validation, outsider denial, private-source RLS, household-specific busy activity and global disconnect all passed with rollback.
- Existing `personal_schedule.sql` and `personal_event_completion.sql`: passed.
- Live browser preview uses simulated Google status/source/sync endpoints and the real local QA database. Verified configured household has no Home link; switching to Fresh Calendar Home shows the grey link; all sources start unchecked; saving selected sources hides the link; returning to the original household preserves its original calendar and task choices.
- Screenshot: `/tmp/sweetmate-fresh-household-connect-link.jpg`.

## Rollout

The additive migration is applied to the local QA database only. Apply it to production before distributing an app build that contains this hook. No production migration, production Google account changes, native release, TestFlight build or submission was performed. The canonical Avery/Blake browser previews use the updated export. Existing TestFlight build 52 remains unchanged until a separately authorized release.
