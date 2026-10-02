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
glass surfaces, and accessibility preferences. Use GlassModalSurface,
GlassModalBackdrop, and GlassButton for new sheets. Do not overwrite v2 components
with older v1 implementations; adapt only the intended behavior.
