# Canonical project

All app changes, fixes, builds, and previews belong to this repository's **main**
branch, tracking `homiev2/main` on GitHub (`lianawarnaku/homiev2`). The canonical
local checkout is `/Users/lianawarnakulasooriya/Downloads/Homie2-main`.

Do not work on or preview `Downloads/Homie` or the retired `homiev1/main`.
Before starting a preview, verify its process working directory is this checkout.

# Architecture and checks

Expo/React Native app: `artifacts/mobile`. Shared state uses its existing
AppContext. Use the singleton Supabase client in `artifacts/mobile/lib/supabase.ts`.
Supabase migrations and Edge Functions live in `supabase/`. Never place server
secrets in Expo public variables or frontend code. Preserve generated API files;
change their OpenAPI source and regenerate if needed.

Run `pnpm run typecheck` and `pnpm --filter @workspace/mobile run test` for mobile
changes. A browser build uses `pnpm --filter @workspace/mobile exec expo export
--platform web --output-dir /tmp/sweetmate-v2-web`.

# Design

Use `.agents/skills/apple-design/SKILL.md` and relevant references for UI work.
Preserve v2's existing light/dark appearance, semantic theme tokens, Inter fonts,
and accessibility preferences. Task rows, lists, general cards, calendars, and
popup/sheet containers use solid fills. Keep glass only on button surfaces and
navigation controls; filter buttons follow the user's selected accent color.
Use GlassModalSurface (a solid container), GlassModalBackdrop, and GlassButton for
new sheets. Do not overwrite v2 components with older v1 implementations; adapt
only the intended behavior.

# Public release reminder

When the user starts final polishing or preparation for public release/publication,
remind them to publish the Google OAuth app and complete branding and Calendar/Tasks
permission verification. They explicitly requested this contextual reminder on
November 25, 2026. Review the release-polish checklist in
`docs/release/website-and-google-verification.md`. This reminder concerns public
launch; it does not block continued internal TestFlight testing.

# TestFlight release control

On November 25, 2026, the owner explicitly stopped build 51 and said not to build
for TestFlight unless they say so. Do not start EAS iOS release builds or submit
or distribute TestFlight builds without an explicit user request for that release.
A request to fix behavior in the current phone build authorizes code fixes and
verification; it does not authorize another native release. Keep the correction
prepared on main until the owner explicitly requests a build/submission.
