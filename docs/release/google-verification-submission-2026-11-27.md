# Google verification submission package

Updated November 28 for homie-502522 / SweetMate Calendar Server. The existing
client ID, client secret and Supabase callback are preserved. Website publication
is complete. The owner approved publishing at action time; Audience is now
**External / In production**. The 100-user unverified cap and warning still apply.
No native build, TestFlight release or purchase was performed.

The existing logo failed Google's automated identity check. The manual-review
path opens a combined branding/data-access submission, which requires a real
YouTube demo URL and scope justification. The 902-character explanation below was
entered, but cannot be saved while the video is missing. The owner deferred the
video. A private Google Calendar reminder is confirmed for November 29 at
10:00 AM Eastern. No appeal or data-access verification was submitted and Google
approval has not been obtained. Keep the staged browser draft; its contents are also here
so an interrupted browser does not lose the preparation.

## Entered scope explanation (902 characters; not yet saved)

> SweetMate combines a user's private schedule with household chores. calendar.calendarlist.readonly lets users select calendars. calendar.events.readonly imports titles/times from selected owned/shared calendars; free-busy lacks the schedule details. calendar.events.owned creates a chore copy in the primary calendar only on explicit export; read-only cannot write and app.created cannot target an existing primary calendar. tasks.readonly imports selected Tasks lists/items; SweetMate checkmarks do not edit Google originals. Identity scopes match the connected account. Legacy calendar.events is retained for installed iOS 1.0.0 (54), which requests it for event imports/primary export. Updated source replaces it with readonly+owned; shared-calendar writes are not a feature. Google data is excluded from analytics/ads. Users can disconnect and request deletion under https://sweetmate.info/privacy.

## Prepared branding appeal (not yet submitted)

The uploaded house mark is the existing SweetMate iOS app icon: a black roof over
four rounded squares. It represents the shared-home product and is paired with
the SweetMate name. It contains no Google product name or Google trademark.
Request manual review of the logo-identity finding, with https://sweetmate.info/
as the public product reference. Do not claim a registered trademark or approval.
Select the actual applicable appeal-reason option shown in the console; none was
yet selected or saved in the final form.

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

## Demonstration script (record the actual app and exact permissions)

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
Do not present synthetic consent screens, stubbed provider calls or generated
footage as live OAuth evidence. Identify the demonstrated platform/version
accurately and show the implementation and exact permissions submitted for review;
Google determines whether the demonstration meets its requirements.

## Submission gates

- [x] Homepage, privacy, support and deletion pages live on sweetmate.info.
- [x] SweetMate logo/name, contacts and authorized domains saved.
- [x] Actual Calendar-list and Tasks scopes declared; new narrower event scopes saved.
- [x] Compatible backend scope policy implemented and tested locally.
- [x] Compatible Calendar backend deployed; anonymous requests rejected.
- [x] Calendar and Tasks APIs both verified in the existing project's Enabled APIs list.
- [ ] Exercise live imports, including Tasks; enabled APIs alone do not prove syncing.
- [ ] Demonstrate the actual requested permissions with real Google consent/API calls, including partial consent, refresh and reconnect. Native acceptance stays on the separate phone release checklist.
- [ ] Retire/justify the temporary broad legacy scope.
- [ ] Owner-reviewed demonstration video uploaded and reviewer-accessible URL supplied.
- [x] Switch audience to Production with owner action-time approval; live status verified.
- [ ] Submit truthful branding appeal and scope verification once the actual demo URL is available.
- [ ] Resolve Google's review requests and receive approval.
- [ ] Test an external Google account absent from the test-user list, including
  a repeated connection and normal subsequent syncing.

No paid branded auth domain, new OAuth client, purchase or native release is
included in this preparation. Google determines review requirements and timing.
