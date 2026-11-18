# SweetMate two-person browser preview

This runs the actual SweetMate web build from this checkout with an isolated local Supabase stack. It never connects to the production project. It creates:

- Avery (`avery@sweetmate.test`), household owner.
- Blake (`blake@sweetmate.test`), regular member.
- `QA Sweet 1`, with both people joined and household setup completed.

The accounts have locally generated passwords and confirmed local emails. They are not real email accounts. The launcher signs each persona in automatically on a separate port. Normal and incognito windows are not necessary: ports 4173 and 4174 keep their browser sessions separate. Both use the same local database and Realtime service.

## Start on your laptop

Prerequisites: **Node.js 22 or later**, **Git**, and **Docker Desktop**, with its engine running. Allow several GB for Docker images and app dependencies. Internet is required for first-run downloads; Expo or Apple account access is not required.

Download this branch's source ZIP, unzip it, and open a terminal in the unzipped folder:

```sh
node scripts/qa-browser/start.mjs
```

On macOS, you can also run `scripts/qa-browser/start.command`. On Windows, use the same Node command in PowerShell, or run `scripts/qa-browser/start.ps1`.

First run clones current GitHub `main` into a managed checkout inside `.sweetmate-qa/`, starts Supabase, applies the repository migrations, creates the local fixtures, installs pinned app dependencies and exports the browser build. Later runs reuse local records. It never resets or modifies your own working checkout. The browser opens when ready:

- Side-by-side launcher: http://127.0.0.1:4172
- Avery: http://127.0.0.1:4173/qa-login
- Blake: http://127.0.0.1:4174/qa-login

Keep the terminal open. Add `QA — wash dishes` in Avery's My Sweet view, then inspect Blake's Group view. Add a second chore as Blake, assign it to Avery, and complete it in Avery's session. Try the $24.60 equal-split expense fixture: Blake should owe Avery $12.30. The launcher includes the full 38-scenario checklist and stores its results in your browser.

## Scope and cleanup

These are real app screens, local auth users, database migrations and shared records—not a UI simulation. Browser/device differences still apply. This local fixture does not configure Google/Apple OAuth, real email delivery, push notifications, or production Edge Function secrets. Those checks need a separate connected test project and, for native behavior, TestFlight devices. The checklist marks unsupported features as blocked rather than passed.

`Ctrl+C` stops the three browser servers. Local Supabase containers and data remain, so the next run can resume. To stop only this QA stack while retaining data:

```sh
npm exec --yes --package=supabase@2.109.1 -- supabase stop --workdir .sweetmate-qa/backend
```

The `.sweetmate-qa/` folder contains local fixture passwords, caches and exports. It is gitignored. Do not publish or share that folder. No production secrets are required. The local service-role key is used only by the Node launcher and is never included in served JavaScript.

While the launcher is running, it checks GitHub `main` every 30 seconds. After a push or PR merge to main, it fetches the new commit, applies new migrations only to the local QA database, rebuilds the app, and refreshes both browser profiles. Changes on an unmerged feature branch do not appear. The launcher shows the running SHA and update status. Ordinary updates retain accounts, sessions and records; a migration that explicitly deletes or transforms data still has its defined effect on local QA records. Failed builds keep the last successful browser bundle and report the error in the terminal. Failed migrations can leave local schema changes already applied, so resolve migration failures before continuing that test run. Keep the terminal and Docker running; stopped/offline previews cannot receive pushes.

To force a frontend rebuild without changing the source, stop the browser servers, delete only `.sweetmate-qa/web`, then restart the launcher. To start from a completely fresh database, use the Supabase CLI's local reset procedure against `.sweetmate-qa/backend` and remove `.sweetmate-qa/fixtures.json`; this destroys only local QA records. Recreating deleted personas/households also requires a fresh fixture run.

## Verification in the Codex environment

The main-source Expo web export succeeded. Launcher syntax and a startup/server smoke check passed with a simulated local Auth/REST service: fixture calls, distinct sessions, one household, all three servers, public-key substitution, the checklist and origin restrictions. This smoke check does not establish real Supabase integration. A full local Supabase startup in the cloud environment failed while extracting Docker images with `no space left on device`; the attempt was stopped. Thus authenticated end-to-end behavior of this launcher has not been established here. The local-only migration preparer also handles the historical optional `avatar_color` field: fresh tables use the default and legacy custom colors are retained. A later real startup exposed a second local-runner difference: the expense migration needs an explicit transaction for LOCK TABLE. The preparer now wraps migrations containing top-level table locks when they do not already declare a transaction. The regression check first reproduces SQLSTATE 25P01 for a standalone lock, then runs all 45 ordered migrations statement-by-statement in disposable PostgreSQL-WASM, with Supabase extension loading/scheduling substituted; this does not establish full Supabase service startup. Production migration files are not modified.

The actual Git updater was also checked against an isolated local remote: initial clone, detection of multiple pushed commits, fast-forward and an unchanged main all passed. The launcher will report a dependency, Docker, migration or fixture error in the terminal instead of pretending the preview is ready.


## Updating a previously downloaded launcher

From the downloaded preview folder, replace the launcher with the current branch version, then run it again. This does not reset your local QA database or reinstall Docker:

```sh
curl -fL https://raw.githubusercontent.com/lianawarnaku/SweetMate/codex/qa-browser-preview/scripts/qa-browser/start.mjs -o scripts/qa-browser/start.mjs
node scripts/qa-browser/start.mjs
```

The corrections include the local fresh-database color migration, explicit transaction boundaries for lock-bearing migrations, and supported `logflare`/`mailpit` exclusion names. The launcher follows main for app code, but the launcher itself must be updated separately when its own setup logic changes.
