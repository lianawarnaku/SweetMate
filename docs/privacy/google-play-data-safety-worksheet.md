# Google Play Data safety worksheet

Verify every answer against the production build and Google Play’s current
definitions before submitting.

| Data category | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Personal info: email, user ID, name | Yes | Service providers | No for account | Account management, app functionality |
| Photos | Yes when selected | Storage provider | Yes | App functionality |
| User-generated content | Yes | Household members and service providers | Feature-dependent | App functionality |
| App interactions | Yes when analytics enabled | PostHog processor | Yes | Analytics |
| Crash logs and diagnostics | Yes when crash reporting enabled | Sentry processor | Yes | App functionality |
| Device or other identifiers | Opaque app identifier when enabled | PostHog/Sentry processors | Yes | Analytics, diagnostics |
| Location | No GPS collection. New PostHog geographic values are cleared server-side and GeoIP is disabled; existing history retained. App-side safeguards await an authorized release. Other providers’ operational logs still require review. | No new location analytics intended | N/A | Reconcile with the actual production build and vendor configuration before submitting |

Data is encrypted in transit. Users can request account deletion in the app.
Confirm retention periods, backup deletion, provider regions, and whether each
processor is treated as “shared” under Google’s service-provider rules.
