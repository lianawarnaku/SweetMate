# SweetMate public website

The owner approved migration from the inaccessible legacy Sites project to the
existing Cloudflare account on November 27, 2026. The live site is now Cloudflare
Pages project `sweetmate-website`, custom domain `sweetmate.info`. Use the
canonical main checkout and the workflow in README.md.

The existing `.openai/hosting.json` identifies only the historical Sites project.
Preserve it for provenance; it is not the current publishing destination. Do not
try to repair publication by inventing another Sites ID or reusing old tokens.

Build the existing Vinext source, then export only static Pages assets with
`scripts/export-cloudflare-static.mjs`. Keep the existing `/auth/confirm` request
logic and `sweetmate://auth/callback` behavior. The exporter derives the browser
effect from that source and fails closed on unknown environment dependencies.
Only the public Supabase client configuration belongs in generated assets.
Never publish `.env` files, server keys, raw source, framework servers or app data.

Run the rendered HTML and static export tests, verify the preview, deploy the
exact `out/` directory, then check the public URLs and Cloudflare domain status.
No TestFlight build or paid plan is part of website publication. Preserve email
and verification DNS records. Keep name analytics gated until its separate
release/consent/store requirements are satisfied.
