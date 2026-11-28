import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How SweetMate handles account, household, Google sign-in, and optional Google Calendar and Tasks information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated November 27, 2026</p>
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

        <h2>Location</h2>
        <p>
          SweetMate does not request or use GPS location or track where you are.
          Roommate availability statuses are chosen manually; they are not
          determined from GPS or background location monitoring. Google Calendar event locations are
          not imported into your SweetMate schedule. Information you voluntarily
          type into a chore, shopping item or other free-text field may itself
          contain an address or place; avoid including sensitive information.
          Ordinary network and security processing by hosting providers is
          described below and is separate from location analytics.
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

        <h2>Optional Google Calendar and Tasks connection</h2>
        <p>
          When you connect Google Calendar in Settings, SweetMate requests
          calendar.events, calendar.calendarlist.readonly, and tasks.readonly
          permissions, plus offline access. Calendar event access allows viewing
          and editing events. We use it to export chores you select and, when you
          enable importing, to synchronize the calendars and Google Tasks lists
          you choose. The Google connection belongs to your account; importing and Busy sharing are configured separately for each household. Basic Google sign-in remains separate from these permissions.
        </p>
        <p>
          Exported events contain chore titles, due dates, and any provided
          descriptions, assignees, household names, and categories. They are
          all-day events with a popup reminder. People with access to your Google
          calendar may see them under your Google sharing settings. Exporting
          creates a copy; later SweetMate changes do not update that copy.
        </p>
        <p>
          Imported events and tasks are stored privately in SweetMate, including
          their titles, dates, available start and end times, and source
          identifiers. Selected calendars and lists sync automatically to organize
          your day. Event and task checkmarks, and times added in SweetMate, stay in SweetMate;
          they do not change the Google originals. Imported titles are not shown to your
          roommates. If you enable calendar busy sharing for a household, active
          members who show roommate activity see only Busy and its end time during
          a current event or scheduled task. You can turn sharing off in Settings.
        </p>
        <p>
          SweetMate verifies that the connected Google account matches the Google
          identity linked to your SweetMate account. Its backend stores refresh
          tokens, cached access tokens and expiry, granted permissions, and
          connection timestamps in a per-user Supabase table that ordinary app
          database clients cannot read. The backend uses these credentials to
          renew access, synchronize your selected resources, and perform exports.
          Imported entries and schedule preferences are accessible only to their
          owner, apart from the optional Busy indicator described above.
        </p>

        <h2>Disconnecting Google and deleting exported events</h2>
        <p>
          You can disconnect Calendar in SweetMate Settings. SweetMate removes
          its stored connection credentials and imported entries, stops busy sharing,
          and attempts to revoke the Google
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
          to provide the sign-in, Calendar, and Tasks features described above. It is not
          sold, used for advertising, used to determine creditworthiness, or used
          to train generalized artificial intelligence or machine learning models.
          Google credentials and imported event or task content are not intentionally
          sent to optional analytics or crash-reporting services. Transfers and
          human access are limited to what that policy permits, including
          providing requested features, necessary security work, and legal
          obligations.
        </p>

        <h2>Optional analytics and crash reporting</h2>
        <p>
          Product analytics and Crash reporting are off by default. The optional
          signup checkbox enables these two choices; it does not enable sharing
          chore or item names. You can change the choices separately in Settings
          → Privacy &amp; Diagnostics. Declining optional sharing does not prevent
          you from using SweetMate.
        </p>
        <p>
          With Product analytics enabled, PostHog receives selected app opens,
          screen visits, active-time measurements, setup progress, feature
          actions and coarse failure categories, along with a random identifier,
          platform, app version, build and environment. The identifier is scoped
          to your account on that device; it is not your email address. It can
          continue from a pre-signup choice to your account on that device.
          PostHog also processes device/OS and session metadata. We have disabled
          IP-based location enrichment and enabled discarding client IP addresses
          in our PostHog project. A server-side filter clears geographic fields,
          device timezone and locale from new incoming analytics. App-side
          safeguards also prevent these fields being sent in updated versions.
          Network services necessarily receive an IP address to deliver a request;
          this does not mean SweetMate uses it to track your location. Historical
          analytics collected before this change remain subject to our retention
          and deletion practices. Random identifiers do not make records anonymous.
        </p>
        <h2>Separate choice to share chore and item names</h2>
        <p>
          When available in your app version, Share chore and item names is a
          separate, initially off choice in Settings → Privacy &amp; Diagnostics.
          It requires Product analytics and your explicit agreement to the
          current name-sharing notice. An earlier analytics choice, the signup
          checkbox or another household member’s choice does not enable it.
        </p>
        <p>
          If you turn it on, SweetMate sends PostHog the names you newly add in
          SweetMate: manual chores, custom planner chores, Random Tasks,
          shopping items, items you select from Sweet Essentials, and manually
          entered expense titles. An expense created from Shopping can include
          the names of selected items that you authored; names automatically
          copied from other members and the shared list title are excluded.
          The event includes the kind of entry and creation source so we can
          understand common chores and purchases, improve task suggestions and
          catalogues, and improve product features. Authorized SweetMate staff
          can view these names in the analytics service for those purposes.
        </p>
        <p>
          Names are sent with the random analytics identifier and technical
          metadata above. Free-text names can reveal personal or sensitive
          details, including details about other people; they are not guaranteed
          to be anonymous or fully redacted. Do not enable this choice for
          entries you do not want used for analytics. The app limits names to
          short labels and skips some obvious email addresses, links and secrets,
          but those checks cannot reliably remove every personal detail.
        </p>
        <p>
          This choice does not upload past entries, scan your household’s saved
          records, collect edits or completion text, or include imported Google
          Calendar/Tasks content. It does not add notes, descriptions, amounts,
          payment information, account display names, email fields, invite codes,
          record/household IDs, Google credentials, receipts or profile photos to
          these name events. Those fields may still be processed separately to
          provide the app’s normal features as described above. Names from a
          failed confirmed-save path are not sent; some local create actions are
          recorded when accepted in the app and may fail to sync later.
        </p>
        <p>
          Turning name sharing off stops new name events. Turning Product
          analytics off also clears the name-sharing choice; turning Product
          analytics back on does not turn name sharing back on. Consent is
          stored per account on each device. This does not erase information
          already collected while your choice was on. You can request access or
          deletion at <a href="mailto:support@sweetmate.info">support@sweetmate.info</a>.
          Provider erasure is a separate process, and identifying records from
          multiple devices may require additional information. Retention and
          backups follow the configured provider processes below; we do not
          promise an unverified fixed retention period.
        </p>
        <p>
          With Crash reporting enabled and configured, Sentry receives sanitized
          diagnostics such as error type, stack trace, affected action and app
          version. Chore/item names are not sent to Sentry through the
          name-sharing feature. SweetMate disables session replay, automatic
          product-event capture and advertising identifiers in these integrations,
          and filters request payloads and direct account/contact fields from
          explicit telemetry. We do not use these records for advertising or sell
          them. New name collection stays disabled until the matching notice is
          published and the app offers the separate choice.
        </p>

        <h2>Service providers and website requests</h2>
        <p>
          Supabase provides authentication, database, and realtime services.
          Google processes sign-in, requested Calendar exports, and selected schedule imports. Expo/EAS
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
          registrations, feedback, Calendar credentials, and imported schedule entries. If provider
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
