# SweetMate TestFlight 1.0.0 (54)

The owner explicitly requested committing the current app and releasing it to
TestFlight on November 26, 2026 (America/New_York). Future builds still require
an explicit release request under AGENTS.md.

## Source and validation

- Current app changes: `cee0b1432bf9c08013b53127a1926078818ae945`.
- Native build fix and final release source: `5d6bedafe91f5ed2a87a93f5ed52d7c2afdff777`.
- Both source commits are pushed to canonical main.
- Includes the attached calendar header, equal task-row sizing and completion
  feedback, optimistic Google completion, Day/Night cutoff at 18:00, random-task
  visibility fixes, interaction audit fixes, household-specific Google setup,
  Other home type, editable chore names, personal hidden tabs, and removal of
  decorative task icons.
- Workspace typecheck and the full mobile regression suite passed. The local
  schedule/privacy/permissions SQL suites passed transactionally with rollback.
- Production iOS/Hermes export passed. After the native build fix, the actual
  `expo export:embed` archive bundling command passed with a cleared cache.

## Backend rollout

Applied `202611260001_household_schedule_setup.sql` and
`202611260002_other_housing_type.sql` to the existing production project.
Private schema and data backups are retained outside Git. Migration history,
new table and RPC, and Other housing validation were checked after deployment.
Before/after dumps confirmed unchanged records in households, household_members,
household_states, household_preferences, chores, proposed_charts, expenses,
shopping_lists, shopping_items, borrow_items and shared_borrow_items.
The existing dedicated Apple review login and its private schedule endpoint
were verified without accessing real users' Google accounts.

## Signed archive

- EAS build: `1c2c457c-a301-4ebb-ba68-e8c58924d605` — FINISHED.
- EAS submission: `50cbef55-2c5e-46ec-b15f-bd36d7d13b8c` — scheduled; processing is being checked.
- App Store Connect app: `6794171916`.
- Signed IPA inspection: bundle `com.homieapplication.homie`, version `1.0.0`,
  build `54`, `DTSDKName=iphoneos27.2`, `DTXcode=2720`, minimum iOS `16.4`.
  UIKit scene lifecycle and the `sweetmate` callback URL scheme are configured.
- The first build attempt, 53 (`89a3099e-7d0a-475a-bed9-3d33efa421df`), failed
  at archive bundling because babel-preset-expo was not a direct dependency.
  It was not submitted. The fix declares the matching preset and resolves it
  from the mobile package, including when Xcode invokes Metro from the workspace.

External availability is recorded below after Apple processing and distribution
are verified. Signing and IPA inspection do not replace physical iPhone testing.
No public App Store release or Google OAuth audience/verification change is part
of this TestFlight release.
