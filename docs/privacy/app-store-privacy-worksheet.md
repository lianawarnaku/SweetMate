# Apple App Privacy worksheet

Use this as a release worksheet, not as legal advice. Verify the production
configuration and Apple’s current definitions before submitting.

| Data type | Collected | Linked to user | Tracking | Purpose |
| --- | --- | --- | --- | --- |
| Email address / user ID | Yes | Yes | No | App functionality, account management |
| User content (chores, shopping, expenses, borrowing) | Yes | Yes | No | App functionality |
| Photos (optional profile image) | Optional | Yes | No | App functionality |
| Product interaction (opens, screens, active time, setup, feature actions) | Optional | Opaque identifier | No | Analytics |
| Coarse technical diagnostics | Optional | Opaque identifier | No | Analytics, app functionality |
| Crash data / performance diagnostics | Optional | Opaque identifier | No | App functionality |
| Advertising identifier | No | No | No | Not collected |
| Precise location | No for telemetry | No | No | Not sent to analytics vendors |

Notes:

- PostHog product events and Sentry diagnostics are separately opt-in and off by default.
- Declare optional collection if the production app allows users to enable it.
- SweetMate does not configure cross-app tracking, advertising, or session replay.
- Confirm whether Apple classifies the opaque analytics ID as linked under the
  final retention and account-access configuration.
