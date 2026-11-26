# Name-sharing preparation and publication blocker

The owner requested analytics for chore, expense-item and shopping-item names. Source now provides separate optional name sharing, with current-notice consent and a default-off build gate. Existing metadata analytics consent does not permit it. Operational database storage is separate from copies sent to PostHog.

Prepared files: `homie-web/app/privacy/page.tsx`, support and deletion pages, mobile signup/settings disclosures, the analytics implementation note, and the Apple privacy worksheet. The public policy URL remains `https://sweetmate.info/privacy`; it has not been replaced or falsely marked published.

On November 26, Sites `get_site` returned legacy metadata for `appgprj_6a62bd55b224819188110603492229f2`, while `create_source_repository_write_credential` again returned `project_not_found` / 404. This is the same publishing-access failure documented in `docs/release/google-public-access-2026-11-26.md`. No duplicate site, domain routing change, purchase, old credential reuse, or access bypass was attempted.

To finish activation after access recovery:

1. Open the authoritative existing Site source through the Sites workflow; reconcile these prepared pages and preserve `/auth/confirm` and domain/runtime settings.
2. Publish and verify privacy/support/deletion text anonymously at the existing URLs.
3. Reconcile App Store Connect Other User Content/Purchase History Analytics purposes and linked-data disclosures against the production configuration. Verify PostHog access, IP/GeoIP, retention and erasure settings.
4. Only then set `EXPO_PUBLIC_ITEM_NAME_ANALYTICS_ENABLED=true` for the intended release, obtain the owner's explicit build/release request, and verify separate opt-in, opt-out, account switch and name capture with dummy data on a device.

There is no current capture of names from already installed apps as a result of this repository change. No Google imported content is included and no real user content was sent during verification.
