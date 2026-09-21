import { appOrigin, readState } from "@/server/oauth-state";
import { storeSlackInstall } from "@/server/installs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = readState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  const back = new URL("/settings/integrations", appOrigin());
  if (!userId || !code || !process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    back.searchParams.set("slack", "error");
    return Response.redirect(back);
  }
  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: `${appOrigin()}/api/slack/callback`,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    access_token?: string;
    bot_user_id?: string;
    app_id?: string;
    team?: { id?: string; name?: string };
  };
  if (!payload.ok || !payload.access_token || !payload.team?.id || !payload.bot_user_id) {
    back.searchParams.set("slack", "error");
    return Response.redirect(back);
  }
  await storeSlackInstall(userId, {
    token: payload.access_token,
    teamId: payload.team.id,
    teamName: payload.team.name || payload.team.id,
    botUserId: payload.bot_user_id,
    apiAppId: payload.app_id,
  });
  back.searchParams.set("slack", "installed");
  return Response.redirect(back);
}
