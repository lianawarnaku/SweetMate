import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated November 24, 2026</p>

        <p>
          SweetMate helps people share household responsibilities. This policy
          explains how we handle information when you use the SweetMate app and
          related services. SweetMate is operated by Liana Warnakulasooriya.
        </p>

        <h2>Information we collect</h2>
        <p>
          Account information includes your email address, display name, profile
          image if you add one, account identifiers, and authentication records.
          If you use Apple or Google to sign in, we receive the account information
          that provider makes available under the permissions you grant.
        </p>
        <p>
          We store the household information you add: Sweet memberships and invite
          codes, chores and assignments, completion history, preferences, shopping
          lists, shared expense and repayment records, IOUs, borrowed items, and
          nudges. Expense records may include amounts, descriptions, and who owes
          whom. SweetMate records these details; it does not transfer money.
          Please avoid adding sensitive information that is unnecessary for
          managing your household.
        </p>
        <p>
          When you send feedback or contact support, we receive your message,
          any contact email you provide, and relevant account and app information,
          such as user ID, app version, platform, and submission time.
          Our hosting and service providers also process technical information
          needed to deliver and secure the service, such as IP addresses,
          connection information, request records, and service logs.
        </p>

        <h2>Optional analytics and crash reporting</h2>
        <p>
          Product analytics and crash reporting are separate choices, both off
          by default. You can use SweetMate without enabling either and change
          your choices in Settings. Turning a choice off stops future collection
          through that feature; it does not automatically erase records already sent.
        </p>
        <p>
          If you enable product analytics, we use PostHog to understand app opens,
          screens visited, time the app is active in the foreground, signup and
          setup progress, feature actions, and general workflow failures. Events
          include a random identifier, platform, app version, build, and environment.
          The identifier used before signup may continue on that device after
          signup. It allows events to be associated with one another even though
          we do not send your name or email in those events.
        </p>
        <p>
          If you enable crash reporting and the service is configured, we use
          Sentry to process sanitized error details, stack traces, affected app
          actions, a random identifier, and app and platform information.
          Our app configuration disables session replay and advertising
          identifiers. Our explicit analytics events exclude household content,
          names, emails, invite codes, photos, expense amounts, passwords, and
          authentication tokens. Providers may still process network and technical
          information when receiving requests.
        </p>

        <h2>Notifications, photos, and connected services</h2>
        <p>
          If you allow push notifications, we store a device push token and
          delivery information so Expo and Apple can deliver notifications.
          Nudge notifications use general reminder text. You can disable
          notifications in your device settings. Access to your photo library is
          requested when you choose a profile photo.
        </p>
        <p>
          If you connect Google Calendar where available, we store connection
          credentials, including access and refresh tokens, to authorize requested
          chore exports and schedule imports. Exported chore details, including
          titles, notes, and dates, are sent to Google Calendar. If you enable
          importing, we privately store entries from the calendars and Google
          Tasks lists you select, including titles, dates, and available times,
          to organize your day. Task checkmarks and times added in SweetMate are
          saved in SweetMate. We use this access to provide the calendar feature,
          not for advertising or product analytics. You can disconnect in Settings
          or revoke access through your Google account. Disconnecting clears
          imported entries and stops calendar busy sharing. Events already
          exported remain in Google Calendar.
        </p>
        <p>
          Calendar busy sharing is optional for each household. If you enable it,
          active household members who show roommate activity can see a Busy
          indicator and its end time during a current event or scheduled task.
          Imported event and task titles remain private. You can turn busy
          sharing off in your Google schedule settings.
        </p>
        <p>
          If you export chores to Apple Reminders, SweetMate requests the relevant
          device permission and writes chore details to your selected reminders
          destination. Apple may synchronize those reminders according to your
          device and iCloud settings. Manage exported reminders in that service.
          Connected services have their own privacy policies.
        </p>

        <h2>How we use information</h2>
        <p>
          We use information to provide accounts and household features,
          synchronize shared activity, deliver requested notifications and
          exports, respond to feedback and support requests, protect the service,
          investigate failures, and meet legal obligations. With your permission,
          we use optional analytics to improve the app and optional crash reports
          to diagnose errors.
        </p>
        <p>
          Where applicable, our legal bases include providing the service you
          request, legitimate interests in operating and securing it, consent for
          optional analytics and diagnostics, and compliance with legal obligations.
          You may withdraw consent in Settings without affecting earlier processing.
        </p>

        <h2>Who can receive information</h2>
        <p>
          Information shared in a Sweet is available to members according to the
          app&apos;s permissions. Invite codes grant access to a household, so share
          them carefully. Other members may retain information they have already
          viewed or copied. Leaving a Sweet does not erase those copies.
        </p>
        <p>
          Service providers process information to operate SweetMate. These
          include Supabase for accounts, data storage, and synchronization;
          Expo/EAS for app delivery and notification services; PostHog for optional
          analytics; Sentry when optional crash reporting is configured; and
          Resend when feedback email delivery is configured. Google and Apple
          process information for the sign-in, notification, and connected
          features you use. We may also disclose information when legally
          required or necessary to protect users and the service.
        </p>
        <p>
          SweetMate does not sell personal information or use the app&apos;s
          analytics for cross-app advertising, cross-context behavioral
          advertising, or data brokerage.
        </p>

        <h2>Retention, deletion, and backups</h2>
        <p>
          We retain account and household information while needed to operate
          the service, maintain shared records, address support and security
          issues, and meet legal obligations. Retention depends on the type of
          information and purpose. Copies in provider logs, backups, exported
          services, and support correspondence may remain after removal from the
          active app and are subject to the relevant retention and deletion processes.
        </p>
        <p>
          You can initiate account deletion in Settings. Apple-linked accounts
          confirm their linked Apple account so we can revoke its authorization.
          Deletion removes your login, profile, private items, memberships, feedback,
          device registrations, and stored integration credentials. If you own a
          Sweet, ownership transfers to another active member; an owned Sweet with
          no remaining active members is deleted. Shared financial and borrowing
          records remain under an anonymous “Deleted member” label to preserve
          other members&apos; records. Removing a membership alone does not delete
          the person&apos;s account. Optional analytics deletion is handled separately
          through our privacy request process; contact us for assistance locating
          records across devices, subject to verification and applicable law.
        </p>
        <p>
          Device analytics identifiers are random and can differ across devices.
          We may need additional information to locate records for a privacy
          request. Do not send passwords or authentication tokens. Deleting your
          account does not automatically delete items already exported to Google
          Calendar or Apple Reminders.
        </p>

        <h2>Security and international processing</h2>
        <p>
          We use access controls and other technical measures intended to protect
          information. No service is completely secure. Providers may process
          information outside your state or country, including in the United
          States. Applicable protections depend on the provider, contract, and
          laws governing the processing.
        </p>

        <h2>Your choices and privacy rights</h2>
        <p>
          You can update your profile, manage household access, change optional
          analytics and crash-reporting choices, revoke device permissions,
          disconnect integrations, and initiate account deletion. Depending on
          where you live, you may have rights to access, correct, delete, or
          receive a copy of your personal information, restrict or object to
          processing, withdraw consent, or appeal a privacy-request decision.
          Contact us to exercise these rights. We may verify your identity before
          acting. You may also complain to your local data-protection authority.
        </p>

        <h2>Children</h2>
        <p>
          SweetMate is intended for people aged 13 and older. If you
          are a parent or guardian with questions about a child’s information,
          contact us to request access, correction, or deletion. If you believe
          a child below the minimum age has provided personal information,
          contact us so we can investigate and take appropriate action.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We will update this policy as the service or our practices change.
          Material changes will be communicated through the app or another
          appropriate channel. Where required, we will request new consent before
          using information for a new purpose.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions or requests, contact{" "}
          <a href="mailto:liana.warnaku@gmail.com">liana.warnaku@gmail.com</a>.
          Please identify SweetMate and describe your request without including
          passwords, sign-in codes, or other unnecessary sensitive information.
        </p>
      </article>
    </main>
  );
}
