# SweetMate website publication — November 27, 2026

> Follow-up: website build dependencies were patched and all 19 rendered/static/auth checks repeated successfully. The final lockfile has no critical/high advisory matches; lower findings remain. The static published content/auth effect is unchanged. See the [final hardening evidence](release-hardening-2026-11-27.md). Earlier dependency findings below describe the original publication run.

**Live:** [privacy](https://sweetmate.info/privacy), [support](https://sweetmate.info/support),
and [account deletion](https://sweetmate.info/delete-account). The homepage and
`/auth/confirm` remain available. Cloudflare reports the domain **Active — SSL enabled**.

## Access recovery and owner approval

The legacy Sites project `appgprj_6a62bd55b224819188110603492229f2` still returns
metadata but its source-credential request returns `project_not_found`/404. The
owner/editor inventories and signed-in Sites library were empty. No credential
was recovered, no new Sites ID was invented, and no access restriction was
bypassed. The owner explicitly chose **Move website to free Cloudflare hosting**
after being informed that this changes website hosting/routing.

Publishing is now available through the owner's existing Cloudflare account,
Pages project `sweetmate-website`. The old Site remains intact; current publishing
no longer depends on restoring that legacy project. Default Pages URL:
https://sweetmate-website.pages.dev/. No purchase, paid plan, TestFlight build,
OTA update, App Store submission or Google OAuth setting change was made.

## Published content

The November 27 policy covers Google Calendar/Tasks, private imports and optional
Busy sharing, SweetMate-only checkmarks, optional PostHog/Sentry choices, the
separate future name-sharing choice, new-location filtering and retained history,
service providers, retention and deletion. It accurately describes availability
as manually selected rather than GPS-derived. Support explains connection and
privacy help. Deletion explains private/imported data removal, retained shared
facts, exported copies and an ownership-verified email assistance route.

Publishing the policy does not enable item-name analytics. Its build gate stays
off pending matching App Store disclosures, separate consent and an authorized
app release. Other public Google verification work remains separate.

## Deployment and preservation

- Created the approved static Pages project, uploaded only 25 files (139,866-byte
  ZIP), verified the Pages URL, then used Cloudflare's existing-domain setup.
- Artifact ZIP SHA-256: `e643a1f7a0d0730d8e27b5a843ceb44d7e6e58e2eab9c1b64557a805b533747e`.
- Cloudflare replaced only the two apex A records with a proxied CNAME to
  `sweetmate-website.pages.dev`. MX, TXT and nameservers were checked unchanged;
  SPF, DKIM, DMARC, Google verification and legacy verification records were
  retained. No app accounts, households, saved records or provider credentials
  were modified. DNS rollback data was captured before the switch.
- Existing source/branding and the confirmation provider request were preserved.
  The static exporter compiles the **actual existing confirmation effect**,
  replacing only its two public environment values and its React DOM adapter.
  The original confirmation source hash is recorded in the artifact manifest.
- Static pages require no framework server or Pages Functions. The only uploaded
  JavaScript is the small confirmation handler. The existing publishable client
  key was validated using a read-only Auth settings request. No service-role,
  Google secret, `.env` file, user content, source map or server credential was
  uploaded.
- CSP permits only same-origin scripts and the existing Supabase Auth connection;
  no-referrer and no-store protect the confirmation page. No website analytics
  beacon was added. Cloudflare's existing email obfuscation is active and was
  verified to decode to the intended support mailto links, including deletion's
  subject. No global protection was disabled.

During propagation some cached old SaaS addresses briefly returned Cloudflare
1034. After domain verification and cache refresh, the normal public URLs passed.
No TLS verification or browser security check was bypassed. Python's separate CA
store could not validate the preview, so checks used the system's normal trusted
HTTPS client; the browser also opened the pages without a warning.

## Checks and evidence

- Website build: passed. **10 rendered-page tests** and **9 static-export/auth
  tests** passed. Confirmation tests use a fake provider for valid, expired and
  network-failure cases; no production email/account was consumed.
- Read-only public checks passed on the Pages preview and sweetmate.info:
  homepage, privacy, support, deletion, confirmation HTML and confirmation JS
  return 200; an unknown path returns 404. Content matches the uploaded artifact,
  allowing only Cloudflare's known email-obfuscation transform. Security headers
  and confirmation no-store behavior were verified.
- Actual browser navigation worked between privacy, support and deletion. Mailto
  destinations decoded correctly. Missing-token confirmation showed the clear
  resend-link error and no false success. No email was sent and no account was
  deleted to verify these informational pages.
- Desktop and 390px-wide layouts were checked. At phone width the document was
  also 390px wide, without horizontal overflow. The viewport override was reset
  and the local preview tab closed. The live privacy page was left available.
- [Rendered tests](website-publication-2026-11-27/rendered-pages-tests.txt),
  [static/auth tests](website-publication-2026-11-27/static-export-tests.txt),
  [preview HTTP](website-publication-2026-11-27/preview-http-checks.json),
  [production HTTP](website-publication-2026-11-27/production-http-checks.json),
  [artifact hashes](website-publication-2026-11-27/artifact-manifest.json),
  [DNS baseline](website-publication-2026-11-27/dns-before.json).
- Screenshots: [live privacy](website-publication-2026-11-27/privacy-live.jpg),
  [phone privacy](website-publication-2026-11-27/privacy-live-phone.jpg),
  [support](website-publication-2026-11-27/support-live.jpg),
  [deletion](website-publication-2026-11-27/delete-live.jpg).

## Limits and maintenance

Real inbox delivery, a valid production confirmation on a physical phone,
password recovery and actual account deletion were not exercised in this website
migration. Production app security and Google public-access reviews remain their
separate workstreams. `www.sweetmate.info` remains outside this migration.

The retained Vinext/Next build-tool dependency tree has audit advisories (the
production dependency audit reported six, including a critical Next advisory).
Those framework/server packages are **not in this static deployment**; the
export intentionally omits their executable bundles and server endpoints. The
local build environment and any future SSR deployment still need dependency
maintenance; this is not a claim that all dependency risk is eliminated.

Future publication uses `homie-web/README.md`, `wrangler.pages.jsonc`, the static
exporter, and the same Cloudflare project. Do not create another site, upload the
whole repository, or use the inaccessible historical Sites destination. Local
app changes were preserved and have not been released by this task.

References: [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/),
[static headers](https://developers.cloudflare.com/pages/configuration/headers/).
