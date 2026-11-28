# SweetMate website

Public pages: [homepage](https://sweetmate.info/), [privacy](https://sweetmate.info/privacy),
[support](https://sweetmate.info/support), [account deletion](https://sweetmate.info/delete-account).

The live host is **Cloudflare Pages Free**, project `sweetmate-website`, in the
existing owner account. The owner approved this migration on November 27, 2026.
The previous OpenAI Sites project remains intact but cannot issue source-write
access in the current account. `.openai/hosting.json` is retained as historical
provenance, not the current deployment destination.

## Prepare an update

Use Node 22.13+ and the pinned lockfile. Install with `npm ci` when dependencies
are absent. Supply `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
through your local/CI environment: the existing production URL and a publishable
or anonymous client key only. Never use the service-role key or Google secrets.
Do not put credentials in shell history or commit `.env` files.

```sh
npm run build:cloudflare
node --test tests/rendered-html.test.mjs
npm run test:cloudflare
```

`out/` is ignored generated output. Upload **only its contents**. The exporter
server-renders the existing source pages, copies their CSS/fonts/images, removes
React/server-component boot scripts, and preserves the confirmation API logic by
compiling the actual effect from `app/auth/confirm/page.tsx` into one small browser
script. No framework server, database binding or server secret is deployed.
`outputs/cloudflare-static-manifest.json` records hashes for the generated output.

The public client key is intentionally present in the confirmation script; it is
not a privileged server credential. The script verifies links against the same
Supabase Auth endpoint and opens the same SweetMate URL scheme after success.
Missing/expired/provider-failure paths remain recoverable.

## Publish without buying anything

Open the existing [Cloudflare project](https://dash.cloudflare.com/4054c966d65b34c70c5cdac316de8c5a/pages/view/sweetmate-website).
Use **Create deployment** and upload the contents of `out/` as a ZIP or folder.
Do not create another project or enable Workers Paid, Functions, databases, Web
Analytics or other paid/optional services for these static pages.

An already authenticated Wrangler installation can also use
`npx wrangler pages deploy out --config wrangler.pages.jsonc --project-name sweetmate-website --branch main`.
Browser upload is sufficient; generating a new API token is not required.
Future Git integration would require a separately planned change because this
is a Direct Upload project.

Check the Pages preview before routing changes, and verify production afterward:

```sh
python3 scripts/verify-published-pages.py https://sweetmate-website.pages.dev preview
python3 scripts/verify-published-pages.py https://sweetmate.info production
```

The checker uses normal verified HTTPS, requires the exact uploaded content
(apart from Cloudflare's known email-address obfuscation), checks security
headers, and checks a real 404. Email addresses must still decode to working
mailto links in a browser. Read-only HTTP verification sends no email or account
mutation. Real inbox delivery and valid-link confirmation need a separately
authorized disposable-account check.

## Domain and rollback

Cloudflare custom domain `sweetmate.info` is Active with SSL. Its apex record is
a proxied CNAME to `sweetmate-website.pages.dev`; nameservers, MX and TXT records
were preserved. No Supabase/OAuth configuration or app records changed. The
existing `www` hostname was not added as part of this bounded migration.

Ordinary content rollback uses the prior successful Pages deployment in the same
project. The first migration's prior apex configuration was DNS-only A records
`172.66.3.26` and `162.159.143.30`, TTL Auto. Returning to the legacy host would
require a deliberate Pages-domain/DNS rollback and a verified working legacy
endpoint; do not change email or verification records.

See [migration verification](../docs/qa/website-publication-2026-11-27.md).
