import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Delete Your Account",
  description: "How to delete your SweetMate account and what happens to shared records and exported events.",
  alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
  return (
    <main className="legal-shell">
      <Link className="brand simple-brand" href="/">SweetMate</Link>
      <article className="legal-card">
        <p className="eyebrow">Your account</p>
        <h1>Delete your account</h1>
        <p>Open SweetMate, go to Settings, choose Delete Account, review what will be removed, and confirm. If your account is linked to Apple, confirm with the same Apple account. Deletion is permanent; leaving a household or uninstalling the app does not delete your account.</p>
        <h2>What is deleted</h2>
        <p>Your login, profile, private records, household memberships, device registrations, feedback, and stored Calendar credentials are removed. Connected provider authorization is revoked as applicable. If provider confirmation fails, retry or contact support.</p>
        <h2>What remains</h2>
        <p>Shared financial and borrowing records remain for your roommates under a household-specific “Deleted member” identity. Ownership transfers to another active member when needed; households with no other active members are deleted. Shared free-text notes may still contain information you entered.</p>
        <p>Previously exported Google Calendar events and reminders remain in those services until you delete them there. Optional analytics erasure is processed separately and is not immediate. Logs and backups follow provider retention processes. See the <Link href="/privacy">Privacy Policy</Link> for details.</p>
        <h2>Cannot sign in or finish deletion?</h2>
        <p>Email <a href="mailto:support@sweetmate.info?subject=SweetMate%20account%20deletion">support@sweetmate.info</a> with the subject “SweetMate account deletion,” preferably from the email associated with your account. We will help verify ownership and process the request. Do not send your password or authorization tokens.</p>
        <p><Link href="/support">Support</Link> · <Link href="/">SweetMate homepage</Link></p>
      </article>
    </main>
  );
}
