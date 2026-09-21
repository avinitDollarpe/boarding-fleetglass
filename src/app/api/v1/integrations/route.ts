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
      note: "Fleetglass Slack bot and GitHub App. Mention targets are the handle, aliases, and GitHub logins configured here. @cursor is not built in.",
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
        displayName: typeof row.displayName === "string" ? row.displayName : "Chief",
        handle: typeof row.handle === "string" ? row.handle : "Chief",
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
