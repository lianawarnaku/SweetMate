import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How SweetMate handles account, household, Google sign-in, and optional Google Calendar information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated November 12, 2026</p>
        <p>
          SweetMate is operated by Liana Amanthi Warnakulasooriya in Massachusetts,
          United States. This policy explains how SweetMate collects, uses, stores,
          and shares information when you use the app and this website. Contact{" "}
          <a href="mailto:support@sweetmate.info">support@sweetmate.info</a>{" "}
          with privacy questions or requests.
        </p>

        <h2>Account and household information</h2>
        <p>
          We process your account email, display name, profile image when provided,
          authentication records, and information you add to SweetMate. Household
          content includes memberships, invite codes, chores, shopping lists,
          expenses and payments, borrowing records, nudges, and preferences.
          We use this information to authenticate you, synchronize the app,
          provide shared household features, respond to support requests, and
          maintain service security. Content in a shared household is visible to
          its members according to the app’s access controls. Avoid adding
          information you do not want other members to see.
        </p>

        <h2>Google sign-in</h2>
        <p>
          If you choose Google sign-in, Google provides basic account information,
          such as your Google account identifier, email address, name, and profile
          picture when available. SweetMate uses this through Supabase
          authentication to establish and secure your SweetMate account. Google
          sign-in is separate from connecting Google Calendar; the sign-in flow
          does not request the additional Calendar permission.
        </p>

        <h2>Optional Google Calendar connection</h2>
        <p>
          When you choose to connect Google Calendar in Settings, SweetMate asks
          for calendar event access using the calendar.events permission and
          offline access to maintain the connection. This Google permission allows
          viewing and editing events on your calendars. SweetMate’s implemented
          feature uses it to add the chores you explicitly export to your Google
          account’s primary calendar; it does not browse or import your existing
          calendar events.
        </p>
        <p>
          Each exported event includes the chore title, due date, and, when
          provided, its description, assignee, household name, and category. It is
          created as an all-day event with a popup reminder. These details are
          sent to Google only when you request the export. They may be visible
          to people with access to your Google calendar under your Google sharing
          settings. Exporting creates a copy; later changes in SweetMate are not
          automatically synchronized to that copy.
        </p>
        <p>
          SweetMate checks that the connected Google account matches the Google
          identity linked to your SweetMate account. Its backend stores a Google
          refresh token, a cached access token and expiry, granted permissions,
          and connection timestamps in a per-user Supabase table. Ordinary app
          database clients cannot read that table. The backend uses the tokens
          to check the connection, renew access, and perform requested exports.
          Google returns the created event’s identifier and link to the app;
          SweetMate does not maintain an imported copy of your calendar.
        </p>

        <h2>Disconnecting Google and deleting exported events</h2>
        <p>
          You can disconnect Calendar in SweetMate Settings. SweetMate removes
          its stored connection credentials and attempts to revoke the Google
          authorization. You can also remove SweetMate’s access in your{" "}
          <a href="https://myaccount.google.com/connections">Google Account connections</a>.
          Disconnecting or deleting your SweetMate account does not delete events
          already exported to Google Calendar. Delete those copies in Google
          Calendar if you no longer want them. Revoking a Google authorization
          may require you to authorize Google sign-in or Calendar again.
        </p>

        <h2>Limited use of Google user data</h2>
        <p>
          SweetMate’s use and transfer of information received from Google APIs
          adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>, including its Limited Use requirements. Google user data is used
          to provide the sign-in and Calendar features described above. It is not
          sold, used for advertising, used to determine creditworthiness, or used
          to train generalized artificial intelligence or machine learning models.
          Google credentials and calendar event content are not intentionally
          sent to optional analytics or crash-reporting services. Transfers and
          human access are limited to what that policy permits, including
          providing requested features, necessary security work, and legal
          obligations.
        </p>

        <h2>Optional analytics and crash reporting</h2>
        <p>
          Product analytics and Crash reporting are separate choices, off by
          default, that you can change in Settings. With Product analytics
          enabled, PostHog receives selected app opens, screen visits, active-time
          measurements, onboarding progress, feature actions, and coarse failure
          categories with a random identifier, platform, app version, build, and
          environment. A pre-signup identifier can continue with your account on
          that device after you opt in. If configured and enabled, Sentry receives
          sanitized error diagnostics, such as error type, stack trace, affected
          action, and app version.
        </p>
        <p>
          SweetMate configures these integrations without session replay,
          automatic product event capture, advertising identifiers, or default
          personal-information collection. The app filters household content,
          names, emails, invite codes, authentication tokens, and request payloads
          from the telemetry it sends. Turning a choice off stops future optional
          collection; it does not automatically erase previously sent records.
          Contact us to request deletion of those records. Vendor erasure may
          require separate processing and information to locate records from
          other devices.
        </p>

        <h2>Service providers and website requests</h2>
        <p>
          Supabase provides authentication, database, and realtime services.
          Google processes sign-in and requested Calendar exports. Expo/EAS
          supports app delivery, updates, and optional push notifications, with
          Apple or Google providing device notification delivery. Device push
          tokens are used for notification delivery; nudge push content does not
          include chore text or the sender’s identity. PostHog and Sentry support
          the optional telemetry described above. Cloudflare and the website
          hosting infrastructure process web requests and related technical data,
          such as IP addresses, browser details, and security cookies, to deliver
          and protect this website. Providers may process information outside
          your state or country. SweetMate does not sell personal information or
          use it for cross-context behavioral advertising.
        </p>

        <h2>Retention and security</h2>
        <p>
          Account information is kept while needed to provide SweetMate and
          address security, support, or legal requirements. Calendar connection
          tokens are retained until disconnection or account deletion, with
          cached access tokens replaced as needed. Technical logs, backups,
          analytics, and diagnostics follow the relevant provider’s configured
          retention and deletion processes; deletion from the active service
          does not guarantee immediate removal from backups. We restrict access
          and use authenticated connections and service access controls, but no
          system can guarantee complete security.
        </p>

        <h2>Account deletion and shared records</h2>
        <p>
          Choose Delete Account in SweetMate Settings to permanently delete your
          account. Apple-linked accounts require confirmation with Apple. The
          process revokes connected provider credentials as applicable and
          removes your login, profile, private records, memberships, device
          registrations, feedback, and Calendar credentials. If provider
          confirmation fails, deletion may stop so you can retry or contact
          support.
        </p>
        <p>
          Shared financial and borrowing records remain for other household
          members under a household-specific “Deleted member” identity.
          Household ownership transfers to another active member when needed;
          a household with no other active members is deleted. Free-text content
          shared with others can still contain information you entered; contact
          us if you need help reviewing it. Previously exported calendar events
          and reminders remain in their destination services. Optional analytics
          deletion requests are processed separately. See{" "}
          <Link href="/delete-account">account deletion help</Link> for instructions.
        </p>

        <h2>Your choices and privacy requests</h2>
        <p>
          You can update your profile, manage household access, disconnect
          Calendar, control notifications and optional telemetry, or delete your
          account. Depending on your location, you may have rights to access,
          correct, obtain a copy of, or delete your information, or to object to
          or restrict processing. Contact{" "}
          <a href="mailto:support@sweetmate.info">support@sweetmate.info</a>.
          We may need to verify account ownership before acting on a request.
          Where applicable, we process information to provide the service,
          protect its security, meet legal obligations, and honor consent for
          optional telemetry. You may withdraw that consent at any time without
          affecting earlier lawful processing.
        </p>

        <h2>Children and policy changes</h2>
        <p>
          If you believe a child has provided personal information without
          appropriate authorization, contact us so we can investigate and respond.
          Material changes to this policy will be communicated in the app or by
          another appropriate method, and the update date above will change.
        </p>
        <p><Link href="/support">Support</Link> · <Link href="/">SweetMate homepage</Link></p>
      </article>
    </main>
  );
}
