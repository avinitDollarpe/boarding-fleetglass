import { SLACK_DISPLAY_NAME, SLACK_HANDLE } from "@/lib/bots";
import { readGithub, readSlack, saveGithubSettings, saveSlackSettings } from "@/server/installs";
import { fleetResponse, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const [slack, github] = await Promise.all([readSlack(userId), readGithub(userId)]);
    return Response.json({
      slack,
      github,
      note: "Display name Richard, handle @richard. Slack aliases include @cursor, cursor bot, and cursoragent. Channel scope * means every channel. GitHub mentions avinitDollarpe, cursor, and cursoragent on DollarPe-Infra and avinitDollarpe repos. app_mention intake still accepts only U08C40K4FHN.",
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
      await saveSlackSettings(userId, {
        displayName: typeof row.displayName === "string" ? row.displayName : SLACK_DISPLAY_NAME,
        handle: typeof row.handle === "string" ? row.handle : SLACK_HANDLE,
        aliases: names(row.aliases),
        channelAllowlist: names(row.channelAllowlist),
        enabled: row.enabled === true,
      });
    }
    const github = body.github;
    if (github && typeof github === "object" && !Array.isArray(github)) {
      const row = github as Record<string, unknown>;
      await saveGithubSettings(userId, {
        mentionTargets: names(row.mentionTargets),
        enabled: row.enabled === true,
      });
    }
    const [nextSlack, nextGithub] = await Promise.all([readSlack(userId), readGithub(userId)]);
    return Response.json({ slack: nextSlack, github: nextGithub });
  } catch (error) {
    return fleetResponse(error);
  }
}
