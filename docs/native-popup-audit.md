# SweetMate native popup audit

Updated August 5, 2026. The static audit reviewed 46 popup implementation sites: 29 app-controlled native alert calls and 17 custom modal roots. No native action-sheet or native text-prompt calls were present.

## Existing architecture and conventions

- `ActionMenuModal` remains the shared tile action menu and complex confirmation sheet for long-press and three-dot actions. It provides a dimmed backdrop, spring/timing animation, themed card and borders, safe-area padding, 44+ point actions, destructive colors, loading/error/success states, outside dismissal, Android back handling, and modal accessibility semantics.
- `AppPopupProvider` is the shared lightweight information, confirmation, destructive confirmation, and multi-choice host. It uses current theme tokens, a 24-point rounded sheet, 46% backdrop, safe-area spacing, text-labelled buttons, loading protection, inline failure feedback, large-text-friendly vertical actions, and consistent iOS/Android/web rendering.
- Feature form modals remain appropriate for structured text and selection. No `Alert.prompt` migration was needed.
- `NudgeToast` remains the nonblocking toast pattern. Existing inline form errors and planning banners remain in place.
- Duplicate feature-owned form sheets were identified in shopping, borrowing, expenses, planning, and settings. They were not force-consolidated because their inputs and navigation behavior differ materially.

## Inventory

| Feature | Trigger | Previous UI | Replacement | Verification |
|---|---|---|---|---|
| Shared confirmations | Expense settlement/deletion, nudge, household/account actions | `useConfirm` called native alert/browser dialog | `AppPopupProvider` confirmation sheet | Static guard + typecheck |
| My Home chores | Calendar destination, permission error, recurring/single deletion | Native alert/multi-choice | App popup information, selection, and destructive sheets | Static guard + typecheck |
| Group chores | Calendar destination, deletion, nudge failures | Native alert/multi-choice | App popup selection/confirmation/information | Static guard + typecheck |
| Settings | Sign out error, restart chart, member/account failures, profile save, leave household | Native alerts | App popup information/confirmation | Static guard + typecheck |
| Task difficulty | Save failure and reset | Native alerts | App popup information/destructive confirmation | Static guard + typecheck |
| Chart alerts | Mutation failure | Native alert | App popup information | Static guard + typecheck |
| Authentication | Privacy-link failure | Native alert | Existing inline authentication error | Static guard + typecheck |
| Analytics consent | Privacy-link failure | Native alert | App popup information | Static guard + typecheck |
| Shopping | Long press, list/item forms and selection | Existing `ActionMenuModal` and form modals | Preserved established custom UI | Source review |
| Expenses/IOUs | Long press, detail, edit/new form | Existing action menu/form modal; confirmations routed through `useConfirm` | Existing UI + app popup confirmation | Source review |
| Borrowing | Long press, return/edit/new flow | Existing action menu/form modal | Preserved established custom UI | Source review |
| Planning/Essentials | Shortlist, generated chores, forms | Existing page sheet, banners, inline validation | Preserved established custom UI | Source review |
| Camera/photo library | Profile photo selection | iOS/Android permission dialog | Required system-controlled prompt — intentionally preserved | Permission API review |
| Apple Reminders | Export chore to Reminders | iOS permission dialog after user export action | Required system-controlled prompt — intentionally preserved | Permission API review |

No unreachable native-popup branches remain. Required photo-library and Reminders dialogs are OS-owned and deliberately preserved. Google OAuth/browser and operating-system authentication surfaces are also outside the app-controlled popup layer.

## Human verification checklist

For every item below, verify on iOS and Android that SweetMate styling appears, Cancel performs no mutation, failures remain visible, rapid taps do not duplicate the popup, and no default app-controlled iOS alert appears:

1. Delete a one-off and recurring chore from My Home and Group.
2. Edit/reassign a chore, mark it complete, and use each three-dot/long-press action.
3. Choose and change a calendar destination; deny Reminders permission once.
4. Long-press shopping lists and items; test delete, pin, expense, and IOU actions.
5. Open expense/IOU edit, settle, delete, split-validation, and failure paths.
6. Open borrowing edit, delete, return, privacy, and history actions.
7. Send and remove a nudge with success and offline failure.
8. Restart chore planning and exercise Sweet Essentials validation/confirmation.
9. Leave a household, delete a household, and remove a roommate.
10. Sign out and delete the account; cancel each before confirming once.
11. Exercise onboarding create/join validation and back/skip behavior.
12. Press Android hardware Back and tap outside every dismissible popup.
13. Repeat with large accessibility text, the black-and-white default theme, dark mode, and an alternate selected theme.
14. Verify VoiceOver/TalkBack announces the title and every destructive text label.

Manual device verification was not performed as part of this code audit.
