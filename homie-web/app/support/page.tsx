import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with SweetMate, Google Calendar connections, and account deletion.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">We’re here to help</p>
        <h1>Support</h1>
        <p>For SweetMate help, contact <a href="mailto:support@sweetmate.info">support@sweetmate.info</a>. Include your app version, device type, and what happened. Never send passwords, authorization tokens, or private household information you do not need to share.</p>
        <h2>Google Calendar</h2>
        <p>Google sign-in and Calendar connection are separate. Connect Calendar in Settings using the Google account linked to your SweetMate account, then export a chore with a due date. It appears as an all-day event in that account’s primary calendar. If access expires, reconnect in Settings.</p>
        <p>Disconnect Calendar in Settings or remove SweetMate in your <a href="https://myaccount.google.com/connections">Google Account connections</a>. Previously exported events remain in Google Calendar and can be deleted there.</p>
        <h2>Account and privacy help</h2>
        <p>Read the <Link href="/privacy">Privacy Policy</Link> or follow the <Link href="/delete-account">account deletion instructions</Link>. Email us if you cannot access your account or a privacy control does not work.</p>
        <p><Link href="/">Return to SweetMate</Link></p>
      </article>
    </main>
  );
}
