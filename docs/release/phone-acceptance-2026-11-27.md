# Real-phone release acceptance

Run against the specifically authorized release candidate; record its version,
build number, source commit, iPhone/iOS version, time and network conditions.
Browser personas and JavaScript exports are not evidence of device acceptance.
Use disposable households and items; preserve real household records.

- [ ] Upgrade while already signed in: restore the same user and households,
  force quit/reopen, refresh the session, then sign out and switch accounts.
- [ ] Confirm all content cards are solid black in dark appearance and controls
  retain the selected accent. Test light appearance, large text and reduced motion.
- [ ] Dismiss My Progress: no horizontal Calendar heading or card remains; weekly
  calendar sits below Welcome Home, scrolls away gently and returns on upward scroll.
- [ ] Create a confirmed email account using a 12-character password; verify email,
  then test old/used/expired reset links, new reset delivery and secure password change.
  An existing shorter password must still sign in until deliberately changed.
- [ ] Complete household setup with two users. Edit setup as either member without
  losing records; approve/restart the chart and verify both approval statuses and
  actual due dates. Dismiss/reopen all relevant preview and edit sheets.
- [ ] Complete/uncomplete a chore and Google item: immediate jiggle/checkmark,
  consistent row size, correct Day/Night split at 18:00, no false caught-up state.
- [ ] Delete a disposable shopping list permanently, relaunch and switch accounts;
  the deleted list stays deleted. Save self/Other borrowing and confirm persistence.
- [ ] Claim/finish random tasks: claimed and completed tasks disappear from the
  top section and remain correctly assigned in the calendar/task views.
- [ ] Switch households: a new household offers its own Google import setup; old
  household schedule preferences are not silently reused.
- [ ] Connect Google, select calendars and Tasks, see details/check SweetMate-only
  completion, export a chore once, retry without duplicate events, disconnect and
  reconnect. Test wrong account, declined partial consent and revoked access.
- [ ] Enable roommate activity: another user sees only Busy/end time during an
  active event; private event names/details are not exposed.
- [ ] Remove/reinvite a disposable member. Old/current shared code alone cannot
  readmit them; fresh account-bound approval works, expires and can be revoked.
- [ ] On airplane mode: save/edit/delete representative chores, lists, expenses,
  borrowing and preferences; terminate immediately, reopen, reconnect and retry.
  Confirm pending/error feedback and exactly one final server result.
- [ ] Race two devices on a completion/payment/chart approval; no duplicate points,
  lost payments or stale approval accepted.
- [ ] Check optional telemetry off/on/off and another account's independent
  consent. No location or Google event/task content should enter telemetry.
- [ ] Delete only an explicitly disposable review account; check private data,
  access revocation, retained shared history and Google disconnect behavior.
- [ ] Recheck fresh installation and device backup/reinstall separately; a surviving
  keychain entry must not resurrect a deleted installation's account.

Record failures with expected/actual behavior and reproducible steps. Do not film
passwords, tokens, personal calendars, recovery links or authenticator codes.
