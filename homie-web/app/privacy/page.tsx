import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="updated">Effective and last updated November 8, 2026 · Version 2026-11-08</p>

        <p>
          This policy explains how [LEGAL ENTITY NAME] (“SweetMate,” “we,” or
          “us”) collects, uses, shares, and protects information when you use
          SweetMate. Before publishing this policy, the owner must replace every
          bracketed field and have the final text reviewed for the places where
          SweetMate is offered.
        </p>

        <h2>Information you provide</h2>
        <p>
          We process account details such as your email address, display name,
          profile image, and authentication records. We also process the
          household content you choose to add, including Sweet memberships and
          invite codes, chores, shopping lists and items, expenses and IOUs,
          borrowing records, nudges, calendar choices, and household preferences.
        </p>

        <h2>Automatically collected technical information</h2>
        <p>
          If you separately enable Product analytics, SweetMate sends a limited
          set of app opens, screen visits, foreground active-time measurements,
          signup and onboarding progress, feature-use actions, and coarse workflow
          failure categories to PostHog together with an opaque app identifier,
          platform, app version, build number, app environment, and update identifier.
          We ask for this optional choice before signup. If you opt in, the random
          identifier used before signup can continue with your account on that device. If you separately enable Crash reporting, SweetMate
          sends sanitized error diagnostics to Sentry, such as error type, stack
          trace, affected app action, platform, app version, build number, and
          app environment. These controls are off by default and can be changed
          at any time in Settings.
        </p>
        <p>
          We configure these services without session replay, automatic product
          event capture, advertising identifiers, default personal-information
          collection, request payloads, or console/network breadcrumbs. SweetMate
          does not intentionally send chore titles, descriptions, shopping item
          names, expense notes, borrowing item names, household or member names,
          email addresses, invite codes, photos, precise location, passwords, or
          authentication tokens to PostHog or Sentry.
        </p>

        <h2>How we use information</h2>
        <p>
          We use information to create and secure accounts, provide and
          synchronize household features, show content to the household members
          you select, process requests, maintain the service, prevent abuse,
          support users, and comply with law. When enabled, optional product
          analytics helps us understand feature adoption and optional crash
          reporting helps us diagnose reliability problems.
        </p>

        <h2>Legal bases</h2>
        <p>
          Where applicable, we rely on performance of our contract to provide
          SweetMate, legitimate interests in security and service operation,
          consent for optional analytics and crash reporting, and legal
          obligations. You may withdraw telemetry consent at any time in
          Settings without affecting earlier lawful processing.
        </p>

        <h2>Sharing and service providers</h2>
        <p>
          Household content is shared with members of the relevant Sweet.
          We use Supabase for authentication, database, storage, and realtime
          synchronization; Expo/EAS for app delivery and updates; PostHog for
          optional product analytics; and Sentry for optional crash diagnostics.
          Providers process information for us under their applicable contracts
          and settings. SweetMate does not sell personal information and does
          not use these services for cross-context behavioral advertising.
        </p>

        <h2>International transfers and retention</h2>
        <p>
          Providers may process information outside your country. We use
          available contractual and technical safeguards as appropriate.
          Account and household information is retained while needed to provide
          the service and meet legal obligations. Optional PostHog and Sentry
          records are retained for [ANALYTICS RETENTION PERIOD]. Deleted
          information may remain in encrypted backups for up to [BACKUP DELETION
          WINDOW] before routine expiration.
        </p>

        <h2>Your choices and rights</h2>
        <p>
          You can turn Product analytics and Crash reporting on or off
          independently in Settings. You can update profile information, leave a
          Sweet, or request account deletion in Settings. Depending on your
          location, you may also request access, correction, deletion, a copy of
          your information, restriction, or objection, or appeal a request
          decision by contacting us. You may complain to your local data
          protection authority.
        </p>

        <h2>Account and household deletion</h2>
        <p>
          Deleting your account removes your login and initiates deletion of
          account-linked information, subject to legal requirements and backup
          expiration. Deleting a Sweet permanently removes its shared chores,
          expenses, shopping lists, borrowing records, and memberships. Removing
          a member revokes that member’s access but does not delete their account.
        </p>

        <h2>Security, children, and changes</h2>
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards, but no system is completely secure. SweetMate is not
          directed to children under [MINIMUM USER AGE], and we do not knowingly
          collect their information. If this policy changes materially, we will
          provide notice in the app or by another appropriate method and update
          the version and date above.
        </p>

        <h2>Contact</h2>
        <p>
          The controller is [LEGAL ENTITY NAME], located in [JURISDICTION].
          Privacy questions and rights requests can be sent to{" "}
          <a href="mailto:support@sweetmate.info">support@sweetmate.info</a>.
          Confirm this is the monitored privacy contact before release and
          replace it with [PRIVACY CONTACT EMAIL] if needed.
        </p>
      </article>
    </main>
  );
}
