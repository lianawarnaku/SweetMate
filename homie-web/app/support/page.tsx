import Link from "next/link";

export default function SupportPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Help</p>
        <h1>SweetMate Support</h1>
        <p>
          Need help with your account, chores, shopping lists, shared expenses,
          or borrowed items? Email{" "}
          <a href="mailto:liana.warnaku@gmail.com">liana.warnaku@gmail.com</a>.
          SweetMate is operated by Liana Warnakulasooriya.
        </p>
        <h2>Report a problem</h2>
        <p>
          Tell us what you were trying to do, what happened, your app version,
          and your device model. You can also send feedback from Settings in
          SweetMate. Please do not send passwords, sign-in codes, invite codes,
          or screenshots containing another person&apos;s private information.
        </p>
        <h2>Account deletion and privacy requests</h2>
        <p>
          You can initiate account deletion from Settings. Apple-linked accounts
          confirm their Apple account. Sweet ownership transfers automatically
          when other active members remain. Shared financial and borrowing history
          remains under “Deleted member.” If you need assistance, email us.
          Do not include your password. See our{" "}
          <Link href="/privacy">Privacy Policy</Link> for information about
          shared records, exported items, and privacy requests.
        </p>
        <h2>Google Calendar during testing</h2>
        <p>
          Calendar access is currently limited to approved Google test users.
          Use the Google account linked to your SweetMate account and allow
          Calendar permissions. Google&apos;s testing authorizations expire after
          seven days; reconnect in Settings when prompted. Contact us if you
          are testing SweetMate and need help with access.
        </p>
        <h2>Shared expenses</h2>
        <p>
          SweetMate records expenses and repayments. It does not transfer money
          or process payments between household members.
        </p>
      </article>
    </main>
  );
}
