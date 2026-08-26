import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const connection = readFileSync(resolve(process.cwd(), "lib/googleCalendarConnection.ts"), "utf8");
const externalTasks = readFileSync(resolve(process.cwd(), "lib/externalTasks.ts"), "utf8");
const repoRoot = resolve(process.cwd(), "..", "..");
const calendarRoute = readFileSync(
  resolve(repoRoot, "artifacts/api-server/src/routes/calendar.ts"),
  "utf8",
);
const connectionRoute = readFileSync(
  resolve(repoRoot, "artifacts/api-server/src/routes/googleCalendarConnection.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations/202608260004_google_calendar_connections.sql"),
  "utf8",
);

assert(
  connection.includes('access_type: "offline"') &&
    connection.includes('prompt: "consent"') &&
    connection.includes("calendar.events"),
  "connecting must request offline access and the calendar scope, forcing consent so a refresh token is actually returned",
);
assert(
  connection.includes("session?.provider_refresh_token"),
  "the mobile app must read Supabase's own provider_refresh_token rather than talking to Google directly",
);

assert(
  externalTasks.includes("export function apiBaseUrl") &&
    externalTasks.includes("Authorization: `Bearer ${accessToken}`"),
  "add-chore calendar export must authenticate as the current user, not call the server anonymously",
);

assert(
  calendarRoute.includes('router.post("/calendar/add-chore", requireUser') &&
    calendarRoute.includes("userCalendarRequest("),
  "add-chore must run behind requireUser and act on the caller's own calendar",
);
assert(
  connectionRoute.includes('router.post("/calendar/connect", requireUser') &&
    connectionRoute.includes('router.post("/calendar/disconnect", requireUser'),
  "connect and disconnect must both require an authenticated caller",
);

assert(
  migration.includes("enable row level security") &&
    !migration.includes("create policy"),
  "google_calendar_connections must have RLS enabled with zero policies granted to client roles — only the service-role key may read refresh tokens",
);

console.log("google calendar connection tests passed");
