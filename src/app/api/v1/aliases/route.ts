import { fleetResponse, requireBearer } from "@/server/http";

export const runtime = "nodejs";

const note =
  "Slack is deploy env only. Display name stays Richard / @richard. Who may mention the bot is SLACK_MENTION_USER_ID.";

export async function GET(request: Request) {
  try {
    await requireBearer(request);
    return Response.json({ note });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireBearer(request);
    return Response.json({ error: "slack_env_only", note }, { status: 410 });
  } catch (error) {
    return fleetResponse(error);
  }
}
