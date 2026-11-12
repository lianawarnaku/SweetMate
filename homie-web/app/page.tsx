import Link from "next/link";

function SweetMateMark() {
  return (
    <div className="homie-mark" aria-label="SweetMate">
      <div className="homie-roof" />
      <div className="homie-tiles" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="page-shell">
      <nav className="nav">
        <Link className="brand" href="/">
          <SweetMateMark />
          <span>SweetMate</span>
        </Link>
        <Link className="text-link" href="/privacy">
          Privacy
        </Link>
      </nav>

      <section className="hero">
        <div className="eyebrow">A happier home, together</div>
        <h1>Make sharing a home feel simple.</h1>
        <p>
          SweetMate keeps chores, shared expenses, shopping, and borrowed items in
          one calm place for everyone in your household.
        </p>
        <a className="primary-button" href="https://testflight.apple.com/join/Ee5PRBzr">
          Join the iOS beta
        </a>
      </section>

      <section className="feature-grid" aria-label="SweetMate features">
        <article>
          <span>01</span>
          <h2>Share the work</h2>
          <p>Plan chores fairly and keep the household in sync.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Settle up simply</h2>
          <p>Track shared expenses without losing the friendly part.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Remember together</h2>
          <p>Keep shopping and borrowed items visible to everyone.</p>
        </article>
      </section>
      <footer className="site-footer" aria-label="Help and legal">
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/support">Support</Link>
        <Link href="/delete-account">Delete your account</Link>
      </footer>
    </main>
  );
}
