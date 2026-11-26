# Google public access: November 26, 2026

This is an implementation audit and submission preparation record, not a claim
that Google has approved public access. The owner approved the public-access
plan, prohibited purchases, and separately approved Search Console domain-owner
verification. Native builds require their own release request.

## Verified console state and completed actions

Project: **Homie**, ID `homie-502522`. Existing working web OAuth client:
**SweetMate Calendar Server**, client ID
`653392398023-33rp4a9o7dhnrk9gabibl4jg9lit1j59.apps.googleusercontent.com`.
Its existing callback is
`https://eqnogaftebuqfwwelbdx.supabase.co/auth/v1/callback`.
Do not replace this client or rotate its working credentials.

- Audience remains External / Testing. No production switch or Google review
  submission was made.
- Branding name SweetMate; homepage https://sweetmate.info; privacy
  https://sweetmate.info/privacy; support/developer contact liana.warnaku@gmail.com.
  Terms-of-service URL is blank. Both sweetmate.info and the existing Supabase
  project hostname are authorized domains.
- Uploaded the existing SweetMate app icon, clicked Save, and observed
  **Branding changes saved!**, Current App logo, and a disabled Save button.
  This saves branding; it is not Google branding verification or publication.
- Data Access lists basic identity scopes and calendar.events. The actual
  released app also requests calendar.calendarlist.readonly and tasks.readonly;
  those were not yet declared in that console page. No scope declaration changed.
- Search Console showed **Ownership verified** for sweetmate.info through the
  Domain name provider method. Owner-approved account: liana.warnaku@gmail.com.
- Added only one root TXT record with Google's exact generated value:
  `google-site-verification=uuqTClXQVn4k065F9sRvID5YpPoTJQJYJtMbf-tViQU`.
  Keep this record to maintain verification. Existing A, MX, SPF, DKIM and
  OpenAI custom-hostname/verification records were preserved. No routing change.
- No purchases, paid auth-domain activation, new native build, or new account.

## Recovered original website history

The original website was created from a local Codex conversation, not from a
Cloudflare Pages project. Its source is checked in under `homie-web`.

| Evidence | Exact identifier / result |
| --- | --- |
| Original archived chat | **Add user preferences system**; local thread `019f9015-05f7-7ad2-bded-867b829b68a0`, started July 23, 2026 |
| Hosting project | `appgprj_6a62bd55b224819188110603492229f2` |
| Site title / slug | Homie / homie-application |
| Created | July 24, 2026 01:18 UTC (July 23 Eastern) |
| Public platform URL | https://homie-application.aranga.chatgpt.site |
| sweetmate.info attachment | `appgdom_6a62d052ec708191a017faf3b3df4dac`, July 24 02:39 UTC |
| Published version | 2; `appgprj_6a62bd55b224819188110603492229f2~appgver_faf6fcaf862481918be8184c2ed5b5ef` |
| Successful deployment | `appgdep_6a62d2f0536c819186021163f97c797e`, July 24 02:50 UTC |
| Source introduction to Git | `68f7cf75fd3d1e375e771cf89c7894786de7dc64`; rebrand `532bec0` |

The archived create_site, add_custom_domain and successful deployment results
establish the original relationship to sweetmate.info. The present Cloudflare
DNS still has `_openai-site-verification` and `_cf-custom-hostname` records.
Authenticated Cloudflare account `4054c966d65b34c70c5cdac316de8c5a` explicitly
shows **No projects found** in Workers & Pages. Cloudflare currently manages DNS
and email routing; that dashboard is not the website editor.

Current limitation: Sites get_site can read legacy metadata, but source-write
credentials, version reads/listing, and custom-domain listing return
`project_not_found` / 404. Owner and editor inventories and the visible ChatGPT
Sites library are empty. The creation history returns no working editor URL.
An empty inventory does not establish which other account/workspace, if any,
controls it; it may require recovery of legacy hosting access.

Do not reuse historical credentials, replace the project ID, create a duplicate
Site, or repoint the live domain to work around this access failure. Restore
publishing access to the identified Site and open its authoritative source with
the Sites source workflow. Preserve its runtime values and `/auth/confirm`.

A support request can use the following text (prepared only; not sent):

> Please help restore editing/source access to my existing OpenAI Sites website,
> Homie, project appgprj_6a62bd55b224819188110603492229f2, originally created July 23,
> 2026 Eastern in a local Codex chat. It serves sweetmate.info and has platform
> URL https://homie-application.aranga.chatgpt.site. get_site returns active legacy
> metadata, but source credentials, versions and domain listing return
> project_not_found. The current owner/editor inventories are empty. Original
> successful version-2 deployment: appgdep_6a62d2f0536c819186021163f97c797e. Please
> restore the existing site's publishing access without changing its domains,
> production environment or access settings.

## Website publication requirements

Live homepage and /privacy return HTTP 200; /support and /delete-account return
404. The live privacy text has the older short household policy and omits the
current Google Tasks/import, Limited Use and optional telemetry disclosures.
Checked-in prepared pages exist, but are not the published version.

After authoritative source access is restored:

1. Reconcile the existing prepared `/privacy`, `/support`, `/delete-account` and
   homepage footer changes with the hosted source. Preserve `/auth/confirm`.
2. Clarify that checkmarks for imported events as well as tasks are SweetMate-only
   and do not edit Google originals. Distinguish a user's global Google OAuth
   connection from the separate import/setup choice in each household.
3. Refine the analytics paragraph: PostHog SDK metadata includes device/OS,
   language/timezone, screen/session information; ingestion can process IP and
   approximate location. The app's filtering is not a blanket guarantee that
   all provider-side personal-information processing is disabled. Verify provider
   settings and retention rather than inventing durations. Google item content
   and credentials must remain excluded from optional telemetry.
4. Match scope wording to the actual released build used for verification. Do
   not publish claims that narrower permissions are live before rollout.
5. Build and check public pages and preserved confirmation error handling; deploy
   through the existing Site; verify anonymous access, exact links, HTTPS and
   current disclosures. Google submission must wait for the live accurate policy.

## Least-privilege assessment

The released build 54 requests identity scopes plus:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/tasks.readonly`

Implementation evidence:

- `artifacts/mobile/lib/googleCalendarConnection.ts`: explicit offline Google
  consent, original SweetMate user verification, provider refresh token sent to
  the authenticated backend; basic Google sign-in is separate.
- `supabase/functions/_shared/calendar.ts`: token exchange and matching linked
  Google identity; server-only credential table; explicit POST only to the
  primary calendar's events endpoint. Existing validation accepts calendar.events
  or full calendar, and would currently reject calendar.events.owned.
- `supabase/functions/_shared/googleSchedule.ts`: read-only calendar/list and
  selected-event imports, read-only task-list/task imports. Sources include
  calendars where the user has reader access. No shared-calendar write feature.
- `supabase/functions/google-schedule/index.ts`: authenticated source/sync routes;
  separate protected worker route. Imported checks and custom times use SweetMate
  storage, not Google Tasks writes.

Google documents calendar.events.owned as sufficient for event insertion, while
calendar.events.readonly covers reading calendars the user can access. Therefore
this is the narrower candidate for the implemented feature set:

| Scope | Purpose / draft justification |
| --- | --- |
| calendar.events.readonly | Import events from only the calendars the user selects into their private My Sweet schedule, including shared calendars where the user has read access. Free/busy alone lacks titles/timing details needed for the user's private event list. |
| calendar.events.owned | On the user's explicit export action, create an all-day chore copy in their primary Google calendar. Read-only access cannot perform this action. Writes to shared calendars are not needed. |
| calendar.calendarlist.readonly | Let the user see and select subscribed calendars; no calendar creation, subscription change or sharing-permission access is used. |
| tasks.readonly | Let the user select Google Tasks lists and import unfinished tasks. SweetMate checkmarks/timing remain app-local, so Tasks write access is unnecessary. |
| openid / email / profile | Establish and verify the Google identity linked to the current SweetMate account; basic sign-in is separate from schedule consent. |

This is a documented candidate, not a tested live grant or shipped change.
calendar.app.created would require moving export to a newly app-created secondary
calendar; that is not the existing primary-calendar feature. Owned-only read
access would omit selected shared calendars. Full calendar access is unnecessary.
Do not submit a broad calendar.events justification that claims shared-calendar
writes are needed; that feature does not exist.

Before changing requests, implement/test backend acceptance of owned-event write
permission, preserving legacy broad grants and same-account checks. Then test
narrow scopes against real Google consent, primary export, duplicate export,
selected owned/shared calendar imports, Tasks, refresh, cancellation, denied
permissions, disconnect and reconnect. Granular/partial consent must produce a
clear recoverable state; current source discovery requests both calendars and
Tasks. Local mocks alone cannot establish actual Google permission behavior.

The mobile scope request is compiled into the app. Narrowing requires a separate
owner-authorized native build and an old-client rollout strategy. Do not remove
legacy console declarations while supported old clients still request them.
No mobile/server scope code or production backend changed in this audit.

## English review demonstration script

Use a dummy household and dummy Google event/task content. Do not record secrets,
refresh tokens, real personal calendar details, or private roommate information.
The recording must correspond to the final scope set and actual release build.

1. Show SweetMate and its public homepage/privacy links, then Settings and the
   disconnected Google schedule controls. State what the integration does.
2. Start Connect; record the complete Google consent screen in English, app name,
   selected account and each requested permission. Show the Google client ID in
   the Console separately without displaying its secret. Finish returning to the
   app and show Connected (include cancellation/denial test separately).
3. Show available calendars and Tasks lists, select dummy sources, enable import,
   and demonstrate their events/tasks in My Sweet with correct dates and times.
4. Open imported details; mark an event and a task complete. Explain that these
   checks stay in SweetMate; show that the Google originals are unchanged.
5. Explicitly export a dated dummy chore; show the resulting all-day event in the
   primary Google calendar. Repeat export and demonstrate no duplicate.
6. With two dummy members, demonstrate optional roommate activity as Busy plus end
   time without imported titles; show it disabled as well.
7. Show household-specific schedule setup when switching households. Then
   disconnect Google and demonstrate disconnected state; explain that exported
   copies remain in Google. Show account-deletion help and privacy contact.
8. Upload the English demo as an unlisted, reviewer-accessible video and use its
   actual URL in Google's verification request. No video is recorded/uploaded yet.

## Submission sequence and remaining gates

- [x] Audit existing working project/client without changing credentials.
- [x] Save the existing app logo in Branding.
- [x] Verify sweetmate.info domain ownership after explicit owner approval.
- [x] Recover the original website creation/publication identifiers.
- [x] Prepare permission assessment, draft justifications and demo script.
- [ ] Restore legacy Sites publishing/source access.
- [ ] Publish and verify accurate privacy, support and deletion pages.
- [ ] Finalize/test least-privilege requests and native rollout with owner approval.
- [ ] Align Data Access declarations with the final supported requests.
- [ ] Complete branding review/publication, Production audience and data-access
  review in the sequence the current Google Console requires.
- [ ] Supply the actual demonstration video and submit Google verification.
- [ ] Follow up on Google's review and verify an account outside the test list.

Do not report public access complete based solely on a saved logo, verified DNS,
Production audience status, or a successful test-user connection. Review timing
and Workspace administrator restrictions are outside SweetMate's control.

## Primary references checked November 26

- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Event insertion permissions](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Tasks scopes](https://developers.google.com/workspace/tasks/auth)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
