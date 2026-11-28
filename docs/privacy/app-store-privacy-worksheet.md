# Apple App Privacy worksheet

Updated November 27, 2026. This worksheet prepares the next release. Location-related App Store Connect checks and the saved Shared Location correction are recorded in [the location privacy report](location-privacy-2026-11-27.md); other rows remain a release worksheet. Reconcile it with the production build and vendor settings before publishing. Name analytics remains gated off until the matching public policy and store disclosures are ready.

| Apple data type | Collection and purpose | Linked to user | Tracking |
| --- | --- | --- | --- |
| Email Address / User ID | Account authentication and app functionality | Yes | No |
| Other User Content | Chores, shopping, expense/borrowing titles and other saved content for app functionality. Separately opted-in new chore/item/expense names also go to PostHog for Analytics when the gated feature is released. | Yes; random analytics IDs do not guarantee anonymity | No |
| Purchases / Purchase History | Expense purchase titles and shopping/purchase tendencies for app functionality; Analytics for eligible names only with the additional opt-in. A shopping-list entry is an intention, not proof of a purchase. | Yes, conservatively | No |
| Other Financial Info | Expense amounts, balances, debts and repayments for app functionality. The name-analytics events exclude amounts, balances and payments. | Yes | No |
| Photos or Videos | Optional profile photo, app functionality | Yes | No |
| Product Interaction | Optional opens, screens, active time, setup and feature actions, Analytics | Yes, conservatively; device/account-scoped random ID | No |
| Other Diagnostic Data / Crash Data | Current production EAS configuration has no Sentry DSN (verified November 28), so the reviewed Sentry path is inactive. Declare actual shipped diagnostics from other sources if applicable; do not describe a prepared SDK as active collection. Reassess before enabling Sentry. | If enabled, yes conservatively | No |
| IP / derived approximate location | PostHog GeoIP is paused, client IP discarding is on, and the active incoming-event filter clears geographic fields, device timezone and locale. Prior analytics are retained by owner request. Operational hosting/security logs are separate and still require vendor review. | Historical analytics remain pseudonymous; do not claim they were erased | No advertising use configured |
| Advertising identifier | Not collected by these integrations | — | No |
| Precise location | No GPS access. Updated source removes the unused location module and legacy coordinate state. App Privacy Precise/Coarse Location were both already unchecked; verified without changing unrelated data types. | — | No |

Before enabling the name-sharing build flag:

1. Publish the accurate public privacy policy and verify its exact URL.
2. Review **Other User Content → Analytics** and **Purchase History → Analytics**, along with linked User ID/usage disclosures. Existing optional functionality collection must also remain declared. Opt-in alone does not exempt routine analytics from disclosure.
3. Treat the random ID and free text as pseudonymous, not anonymized. Generic text can itself identify a person. Apple classifies generic free text as Other User Content; do not invent a blanket “not linked” claim.
4. PostHog IP/GeoIP settings and the incoming location filter were changed and verified November 27. Retention duration, other vendors’ operational logs, access restrictions and erasure procedures still need verification. Existing history was intentionally not deleted.
5. Update App Store Connect before the release collects names, then request the separately authorized native release and test consent/opt-out on-device.

The signup checkbox permits only ordinary product analytics and sanitized crash reporting. The new name-sharing choice is separate, off by default, current-notice gated, reversible and unavailable when Product analytics is off. Google Calendar/Tasks content and automatically copied peer shopping entries stay excluded. This change does not introduce cross-app advertising tracking, session replay, or an advertising identifier.

References: [Apple App Privacy definitions, collection and linked-data guidance](https://developer.apple.com/app-store/app-privacy-details/), [PostHog data storage, retention and deletion](https://posthog.com/docs/privacy/data-storage). Expense/shopping classification above applies those definitions conservatively to SweetMate; final submission must match the actual released configuration.
