import { SLACK_DISPLAY_NAME, SLACK_HANDLE } from "@/lib/bots";
import { listSlack, readGithub, saveGithubSettings, saveSlackSettings } from "@/server/installs";
import { fleetResponse, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const [slack, github] = await Promise.all([listSlack(userId), readGithub(userId)]);
    return Response.json({
      slack,
      github,
      note: "Each Slack bot is a connector on this account. Signing secret, bot token, and the owner allowlist are encrypted on the row. POST /api/slack/events picks the connector from team_id and api_app_id.",
    });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const slack = body.slack;
    if (slack && typeof slack === "object" && !Array.isArray(slack)) {
      const row = slack as Record<string, unknown>;
      const saved = await saveSlackSettings(userId, {
        id: typeof row.id === "string" ? row.id : null,
        displayName: typeof row.displayName === "string" ? row.displayName : SLACK_DISPLAY_NAME,
        handle: typeof row.handle === "string" ? row.handle : SLACK_HANDLE,
        aliases: names(row.aliases),
        channelAllowlist: names(row.channelAllowlist),
        enabled: row.enabled === true,
        signingSecret: typeof row.signingSecret === "string" ? row.signingSecret : "",
        botToken: typeof row.botToken === "string" ? row.botToken : "",
        teamId: typeof row.teamId === "string" ? row.teamId : "",
        apiAppId: typeof row.apiAppId === "string" ? row.apiAppId : "",
        botUserId: typeof row.botUserId === "string" ? row.botUserId : "",
        ownerSlackUserIds: Array.isArray(row.ownerSlackUserIds) ? names(row.ownerSlackUserIds) : undefined,
        ownerEmails: Array.isArray(row.ownerEmails) ? names(row.ownerEmails) : undefined,
      });
      if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.error === "missing" ? 404 : 400 });
    }
    const github = body.github;
    if (github && typeof github === "object" && !Array.isArray(github)) {
      const row = github as Record<string, unknown>;
      await saveGithubSettings(userId, {
        mentionTargets: names(row.mentionTargets),
        enabled: row.enabled === true,
      });
    }
    const [nextSlack, nextGithub] = await Promise.all([listSlack(userId), readGithub(userId)]);
    return Response.json({ slack: nextSlack, github: nextGithub });
  } catch (error) {
    return fleetResponse(error);
  }
}
