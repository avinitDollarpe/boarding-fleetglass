import { readGithub, saveGithubSettings } from "@/server/installs";
import { SLACK_MENTION_USER_DEFAULT } from "@/lib/bots";
import { fleetResponse, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function slackNote() {
  return {
    source: "env",
    mentionUserId: process.env.SLACK_MENTION_USER_ID?.trim() || SLACK_MENTION_USER_DEFAULT,
    note: "Slack is deploy env only: SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, SLACK_MENTION_USER_ID. This route does not store Slack secrets.",
  };
}

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const github = await readGithub(userId);
    return Response.json({ slack: slackNote(), github });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const github = body.github;
    if (github && typeof github === "object" && !Array.isArray(github)) {
      const row = github as Record<string, unknown>;
      await saveGithubSettings(userId, {
        mentionTargets: names(row.mentionTargets),
        enabled: row.enabled === true,
      });
    }
    const nextGithub = await readGithub(userId);
    return Response.json({ slack: slackNote(), github: nextGithub });
  } catch (error) {
    return fleetResponse(error);
  }
}
