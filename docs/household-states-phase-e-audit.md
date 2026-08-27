# Household states Phase E audit

Audited after chores, expenses, shopping lists/items, and shared borrow items gained normalized read/write paths. `private_borrow_items` remains a separate private table. `household_states` is retained and no table or column is dropped.

## Classification of the remaining payload

| Field | Classification | Current readers/writers | Recommendation |
| --- | --- | --- | --- |
| `roommates` | Household-global presentation cache | `AppContext` score/avatar hydration and chore point mutations | Split scores into an atomic member-stats table before any table retirement; membership identity already comes from `household_members`. |
| `essentialOwned` | Entity-like per-household selection | Essentials UI and `AppContext` | Normalize if concurrent ownership toggles must be lossless. |
| `essentialShortlistUpdatedBy` | Household-global metadata | Essentials shortlist UI | Move beside the normalized shortlist records or derive it. |
| `roommateStatuses`, `sleepStartedAt` | User-specific presence state shared with household | Home/status UI and `AppContext` | Normalize per member with expiry semantics; these are poor whole-document fields. |
| `homeLocation` | Household-global configuration | Location/status behavior | Retain here or move to a one-row household settings table with restricted write policy. |
| `choreChart`, `choreChartStartedAt`, `liveChart` | Entity/workflow state | Planning and chore-chart screens | Normalize or consolidate with `proposed_charts` before retirement. |
| `homeProfile` | Household-global configuration | Planning/task generation | Good candidate for a household settings/profile row. |
| `customTasks` | Entity collection | Planning task builder | Normalize if concurrent editing is supported. |

## Removed from new blob writes

`chores`, `expenses`, `shoppingLists`, `shoppingItems`, `shoppingSyncMeta`, and shared `borrowItems` are omitted only after all normalized collections complete bootstrap for the active household. Legacy fields can still be read during bootstrap so existing production data is migrated in place.

## Reader and writer inventory

- Cloud hydration and Realtime snapshot handling: `artifacts/mobile/context/AppContext.tsx` (`household_states` subscription and `applySharedState`).
- Cloud writes: the deferred household snapshot writer and immediate completed-chore score writer in `AppContext`.
- Local per-household cache: AsyncStorage serialization/hydration in `AppContext`; it intentionally retains a complete local view for offline startup and is not the database blob.
- Normalized entity readers/writers: `chores`, `expenses`, `shopping_lists`, `shopping_items`, and `shared_borrow_items` subscriptions in `AppContext`.

## Recommendation

Retain `household_states` temporarily for household-global configuration, but reduce it to a deliberately versioned settings document. Normalize member scores/statuses and remaining entity arrays first. After that, choose between keeping a small settings row (simplest) or moving `homeLocation`/`homeProfile` into a typed `household_settings` table and retiring `household_states`. No destructive retirement is recommended yet.
