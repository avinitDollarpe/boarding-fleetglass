import { auth } from "@/auth";
import { appOrigin, signState } from "@/server/oauth-state";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.redirect(new URL("/login", appOrigin()));
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return Response.redirect(new URL("/settings/integrations?slack=unconfigured", appOrigin()));
  const redirectUri = `${appOrigin()}/api/slack/callback`;
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "scope",
    "app_mentions:read,channels:history,groups:history,im:history,mpim:history,chat:write,users:read",
  );
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", signState(session.user.id));
  return Response.redirect(url);
}
