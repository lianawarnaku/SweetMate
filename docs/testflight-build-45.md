# TestFlight 1.0.0 (45) — November 9, 2026

Source: canonical main commit `1acad6cfec28b0ddf238a6bbf1df1794c23f99df`, committed and pushed to GitHub. The working tree was clean when uploaded.

Included: selectable Group calendar weeks and Group/Calendar/Archive controls; removed House Monitor heading; simplified Expenses overview with preserved collapsing, tappable balance cards and filter reset; hidden points associated with the deferred leaderboard; Calendar OAuth/endpoint repairs; native nudge push registration, delivery queue, and notification navigation; reviewed pending feedback fixes and regression harnesses.

## Signing and delivery

The account holder accepted Apple's updated agreement. Push Notifications capability and the APNs key are configured. Provisioning profile `MS4JLCVVBQ` replaces the invalid profile for new builds and includes the required push capability. The existing distribution certificate was reused.

- EAS build: `2ee9fedd-9c93-4604-87bb-73e1633a5dd5`, FINISHED.
- EAS submission: `5a526f21-9ffa-4263-80a3-fbaa3e075c76`, FINISHED.
- Native build completed November 9 at 11:41 PM America/New_York; upload completed the same minute.
- App Store Connect app: `6794171916`.
- Apple processing completed. Build 45 is assigned to the existing internal TestFlight group `Sweet Mates!` (3 testers). External testing status is `Ready to Submit`; external beta review has not been submitted.

[Build](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/builds/2ee9fedd-9c93-4604-87bb-73e1633a5dd5)

[Submission](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/submissions/5a526f21-9ffa-4263-80a3-fbaa3e075c76)

## Checks

Workspace typecheck, full mobile tests, integration runtime tests, isolated PostgreSQL push lifecycle/security tests, Deno Edge Function checks, seven feedback server tests, production web export, and git diff checks passed. The native iOS archive and App Store Connect upload succeeded. Calendar and nudge-push server functions and the push scheduler are deployed.

Real-device notification receipt and real Google event creation still require validation after installing this build. Google OAuth remains in External/Testing; public verification is separate. No public App Store release was performed. Nikita's invitation was not sent, at the user's request.
