# Points and leaderboard — deferred

Status: deferred at the user's request on November 9, 2026. Revisit points and the leaderboard together in a later product pass.

The release flag `LEADERBOARD_ENABLED` in `artifacts/mobile/constants/featureAvailability.ts` is off. It hides Ranks, its direct route, the points preference, and all numeric points displays. Point counts on My Sweet, chore rows, Group roommate headers, the manual chore editor, household setup, and new calendar exports belong to this same feature. Group completion progress bars remain visible and continue to use completed/total chore counts.

Preserve stored chore point values, roommate lifetime/weekly scores, preferences, completion and undo scoring, pickup bonuses, and leaderboard code. This is a presentation change; no scores are cleared or migrated. Setup difficulty choices retain their numeric values behind descriptive labels. Existing external calendar entries are not rewritten.

Before restoring the feature, review scoring and pickup attribution, completion/undo consistency, weekly versus lifetime totals, and leaderboard presentation. Then enable the shared flag and validate counts, settings, forms, calendar exports, and Ranks together, including users with saved points preferences enabled or disabled.
