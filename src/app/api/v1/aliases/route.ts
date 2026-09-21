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
      note: "Chief is the Slack app. Match its handle and these aliases. app_mention intake accepts only the configured mentioner, default U08C40K4FHN.",
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
    await saveSlackSettings(userId, { ...current, aliases });
    const slack = await readSlack(userId);
    return Response.json({ aliases: slack.aliases, handle: slack.handle });
  } catch (error) {
    return fleetResponse(error);
  }
}
