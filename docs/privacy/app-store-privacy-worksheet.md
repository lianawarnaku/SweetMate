# Apple App Privacy worksheet

Updated November 26, 2026. This worksheet prepares the next release; it does not change App Store Connect. Reconcile it with the production build and vendor settings before publishing. Name analytics remains gated off until the matching public policy and store disclosures are ready.

| Apple data type | Collection and purpose | Linked to user | Tracking |
| --- | --- | --- | --- |
| Email Address / User ID | Account authentication and app functionality | Yes | No |
| Other User Content | Chores, shopping, expense/borrowing titles and other saved content for app functionality. Separately opted-in new chore/item/expense names also go to PostHog for Analytics when the gated feature is released. | Yes; random analytics IDs do not guarantee anonymity | No |
| Purchases / Purchase History | Expense purchase titles and shopping/purchase tendencies for app functionality; Analytics for eligible names only with the additional opt-in. A shopping-list entry is an intention, not proof of a purchase. | Yes, conservatively | No |
| Other Financial Info | Expense amounts, balances, debts and repayments for app functionality. The name-analytics events exclude amounts, balances and payments. | Yes | No |
| Photos or Videos | Optional profile photo, app functionality | Yes | No |
| Product Interaction | Optional opens, screens, active time, setup and feature actions, Analytics | Yes, conservatively; device/account-scoped random ID | No |
| Other Diagnostic Data / Crash Data | Optional diagnostics for app functionality and quality; only declare Performance Data if the shipped implementation actually sends it | Yes, conservatively | No |
| IP / derived approximate location | Hosting and analytics requests may be processed by providers. Verify stored IP, GeoIP and retention settings; declare the corresponding Coarse Location/diagnostic purposes if retained. Do not assume the app’s content filter removes provider metadata. | Verify provider configuration | No advertising use configured |
| Advertising identifier | Not collected by these integrations | — | No |
| Precise location | Not sent by optional telemetry | — | No |

Before enabling the name-sharing build flag:

1. Publish the accurate public privacy policy and verify its exact URL.
2. Review **Other User Content → Analytics** and **Purchase History → Analytics**, along with linked User ID/usage disclosures. Existing optional functionality collection must also remain declared. Opt-in alone does not exempt routine analytics from disclosure.
3. Treat the random ID and free text as pseudonymous, not anonymized. Generic text can itself identify a person. Apple classifies generic free text as Other User Content; do not invent a blanket “not linked” claim.
4. Verify PostHog technical metadata, project retention, IP/GeoIP processing, access restrictions and erasure procedures. No vendor setting was changed or retention period verified by this source change.
5. Update App Store Connect before the release collects names, then request the separately authorized native release and test consent/opt-out on-device.

The signup checkbox permits only ordinary product analytics and sanitized crash reporting. The new name-sharing choice is separate, off by default, current-notice gated, reversible and unavailable when Product analytics is off. Google Calendar/Tasks content and automatically copied peer shopping entries stay excluded. This change does not introduce cross-app advertising tracking, session replay, or an advertising identifier.

References: [Apple App Privacy definitions, collection and linked-data guidance](https://developer.apple.com/app-store/app-privacy-details/), [PostHog data storage, retention and deletion](https://posthog.com/docs/privacy/data-storage). Expense/shopping classification above applies those definitions conservatively to SweetMate; final submission must match the actual released configuration.
