import { readSlack, saveSlackSettings } from "@/server/installs";
import { fleetResponse, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const slack = await readSlack(userId);
    return Response.json({
      handle: slack.handle,
      displayName: slack.displayName,
      aliases: slack.aliases,
      channelAllowlist: slack.channelAllowlist,
      enabled: slack.enabled,
      installed: slack.installed,
      note: "Aliases belong to this account’s Slack connector. Who may mention the bot is that connector’s owner allowlist, stored with the signing secret.",
    });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const current = await readSlack(userId);
    const aliases = Array.isArray(body.aliases) ? body.aliases.filter((item): item is string => typeof item === "string") : current.aliases;
    const saved = await saveSlackSettings(userId, {
      id: current.id,
      displayName: current.displayName,
      handle: current.handle,
      aliases,
      channelAllowlist: current.channelAllowlist,
      enabled: current.enabled,
      teamId: current.teamId ?? "",
      apiAppId: current.apiAppId ?? "",
      botUserId: current.botUserId ?? "",
      ownerSlackUserIds: current.ownerSlackUserIds,
      ownerEmails: current.ownerEmails,
    });
    if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
    const slack = await readSlack(userId);
    return Response.json({ aliases: slack.aliases, handle: slack.handle });
  } catch (error) {
    return fleetResponse(error);
  }
}
