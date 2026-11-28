# Google verification submission package

Prepared for homie-502522 / SweetMate Calendar Server. The existing client ID,
client secret and Supabase callback are preserved. Website publication is complete.
The current console remains External/Testing; saving scope declarations does not
make Google access public or mean Google has verified SweetMate.

## Scope justification for the next candidate

| Scope | User-visible purpose | Restriction |
| --- | --- | --- |
| openid, email, profile | Sign in and match the connected Google account | No Gmail access |
| calendar.calendarlist.readonly | Let the user choose subscribed calendars | Does not modify the list or sharing |
| calendar.events.readonly | Automatically import events from selected calendars, including shared ones | No edits to shared-calendar events |
| calendar.events.owned | Explicitly add a SweetMate chore to the user's primary Google calendar | Requests never target another calendar for export |
| tasks.readonly | Import Google Tasks lists/items | SweetMate checkmarks/time changes do not edit Google Tasks |

Temporary calendar.events is still declared for installed builds that request it.
The new client does not request it. After the corrected candidate passes phone
acceptance, remove this obsolete declaration before the final narrow-scope review,
or explicitly justify its continued legacy use to Google. Existing grants remain
compatible on the backend; do not rotate working credentials to migrate scopes.

## Demonstration script (record the actual tested candidate)

1. Show SweetMate's name/version and the public homepage, privacy, support and
   deletion URLs. Show the matching project/client, without revealing credentials.
2. Sign in with a dedicated review account. Show that ordinary sign-in does not
   silently connect Calendar. Open Settings → Google schedule / Connect.
3. Show the full Google consent flow and all requested permissions in English.
   If Google offers individual scope checkboxes, grant the demonstrated feature's
   requested access. Show rejection/cancellation returning safely to the app.
4. Select a disposable calendar and Tasks list, import a named dummy event and
   task, show their SweetMate details and active-event timer. Check an item and
   show its original Google record remains unchanged.
5. Export a disposable chore to the primary calendar, show its due date and
   retry once to demonstrate duplicate prevention. Do not export shared-calendar
   edits or claim the app supports Google Task writeback.
6. Show household import choices are separate, and roommate activity shares only
   Busy/end time when the user enables that setting.
7. Disconnect in Settings, show imports stop, and demonstrate the account-deletion
   route using only an explicitly disposable account or stop before final deletion.
8. End with support/privacy links and the Google Limited Use disclosure.

Use dummy names only. Keep passwords, OAuth/session tokens, reset links, client
secrets, real calendar details and MFA credentials out of the recording. An
unlisted YouTube/video URL must be accessible to Google reviewers without a login.
Do not substitute browser personas or edited footage for a tested native flow.

## Submission gates

- [x] Homepage, privacy, support and deletion pages live on sweetmate.info.
- [x] SweetMate logo/name, contacts and authorized domains saved.
- [x] Actual Calendar-list and Tasks scopes declared; new narrower event scopes saved.
- [x] Compatible backend scope policy implemented and tested locally.
- [x] Compatible Calendar backend deployed; anonymous requests rejected.
- [ ] Verify Calendar and Tasks APIs are enabled and exercise live imports, including Tasks.
- [ ] Test the narrower-scope candidate on the owner's phone, including partial consent, refresh and reconnect.
- [ ] Retire/justify the temporary broad legacy scope.
- [ ] Owner-reviewed demonstration video uploaded and reviewer-accessible URL supplied.
- [ ] Switch audience to Production and submit truthful branding/scope verification
  at the appropriate final console step, observing any action-time confirmation.
- [ ] Resolve Google's review requests and receive approval.
- [ ] Test an external Google account absent from the test-user list, including
  a repeated connection and normal subsequent syncing.

No paid branded auth domain, new OAuth client, purchase or native release is
included in this preparation. Google determines review requirements and timing.
