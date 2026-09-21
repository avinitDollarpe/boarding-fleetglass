export default function HomePage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: "2rem", maxWidth: "40rem" }}>
      <h1>Fleetglass</h1>
      <p>API that wakes Richard from Slack and GitHub. The contract is in README.md.</p>
      <ul>
        <li>
          <code>GET /api/health</code>
        </li>
        <li>
          <code>POST /api/slack/events</code>
        </li>
        <li>
          <code>POST /api/github/webhook</code>
        </li>
      </ul>
    </main>
  );
}
