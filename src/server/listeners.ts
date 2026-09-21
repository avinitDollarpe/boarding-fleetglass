import { createHmac, timingSafeEqual } from "crypto";
import { channelAllowed, githubMentioned, slackMentioned } from "@/lib/bots";
import { createTask, launchTask } from "@/server/fleet";
import { githubInstallForId, slackInstallForTeam } from "@/server/installs";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySlackSignature(raw: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex");
  return safeEqual(signature, `v0=${digest}`);
}

export function verifyGithubSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqual(signature, `sha256=${digest}`);
}

async function handoff(
  userId: string,
  created: { deduped: boolean; task: { id: string; state: string } },
  prompt: string,
  repoUrl: string | null,
) {
  if (created.deduped || created.task.state !== "Holding") return created;
  try {
    await launchTask(userId, created.task.id, { prompt, repoUrl }, "system");
  } catch {
    // Plan refusals and Cursor errors are already stored on the task.
  }
  return created;
}

async function slackPermalink(token: string, channel: string, ts: string): Promise<string> {
  const fallback = `https://slack.com/archives/${channel}/p${ts.replace(".", "")}`;
  try {
    const response = await fetch("https://slack.com/api/chat.getPermalink", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, message_ts: ts }),
      signal: AbortSignal.timeout(4000),
    });
    const body = (await response.json()) as { ok?: boolean; permalink?: string };
    return body.ok && body.permalink ? body.permalink : fallback;
  } catch {
    return fallback;
  }
}

export async function receiveSlackEvent(raw: string, timestamp: string | null, signature: string | null) {
  if (!process.env.SLACK_SIGNING_SECRET) return { status: 503, body: { error: "slack_unconfigured" } };
  if (!verifySlackSignature(raw, timestamp, signature)) return { status: 401, body: { error: "invalid_signature" } };
  const payload = JSON.parse(raw) as {
    type?: string;
    challenge?: string;
    team_id?: string;
    event?: {
      type?: string;
      user?: string;
      bot_id?: string;
      text?: string;
      ts?: string;
      channel?: string;
      channel_name?: string;
    };
  };
  if (payload.type === "url_verification") return { status: 200, body: { challenge: payload.challenge } };
  const event = payload.event;
  if (!payload.team_id || !event?.ts || !event.channel || event.bot_id) return { status: 200, body: { ok: true, ignored: "empty" } };
  if (event.type !== "app_mention" && event.type !== "message") return { status: 200, body: { ok: true, ignored: "event" } };

  const install = await slackInstallForTeam(payload.team_id);
  if (!install || !install.enabled) return { status: 200, body: { ok: true, ignored: "disabled" } };
  if (event.user && install.botUserId && event.user === install.botUserId) return { status: 200, body: { ok: true, ignored: "self" } };
  if (!channelAllowed(install.channelAllowlist, event.channel, event.channel_name)) {
    return { status: 200, body: { ok: true, ignored: "channel" } };
  }
  const text = event.text ?? "";
  const mentioned =
    event.type === "app_mention" ||
    slackMentioned(text, { handle: install.handle, aliases: install.aliases, botUserId: install.botUserId });
  if (!mentioned) return { status: 200, body: { ok: true, ignored: "mention" } };

  const permalink = await slackPermalink(install.token, event.channel, event.ts);
  const created = await createTask(
    install.userId,
    {
      trigger: "slack_bot_mention",
      sourceRef: permalink,
      owner: install.displayName,
      payload: {
        teamId: payload.team_id,
        channelId: event.channel,
        channel: event.channel_name,
        permalink,
        text,
        user: event.user,
        slackTs: event.ts,
        messageTs: event.ts,
      },
    },
    "system",
  );
  await handoff(install.userId, created, text || "Slack mention", null);
  return { status: 200, body: { ok: true, taskId: created.task.id, deduped: created.deduped } };
}

export async function receiveGithubWebhook(raw: string, signature: string | null, eventName: string | null) {
  if (!process.env.GITHUB_WEBHOOK_SECRET) return { status: 503, body: { error: "github_unconfigured" } };
  if (!verifyGithubSignature(raw, signature)) return { status: 401, body: { error: "invalid_signature" } };
  if (eventName !== "issue_comment" && eventName !== "pull_request_review_comment") {
    return { status: 200, body: { ok: true, ignored: "event" } };
  }
  const payload = JSON.parse(raw) as {
    action?: string;
    installation?: { id?: number };
    repository?: { full_name?: string; html_url?: string };
    issue?: { number?: number; pull_request?: unknown };
    pull_request?: { number?: number; html_url?: string };
    comment?: { id?: number; body?: string; html_url?: string; user?: { login?: string } };
  };
  if (payload.action && payload.action !== "created") return { status: 200, body: { ok: true, ignored: "action" } };
  const installationId = payload.installation?.id ? String(payload.installation.id) : "";
  const comment = payload.comment;
  if (!installationId || !comment?.id || !comment.body) return { status: 200, body: { ok: true, ignored: "empty" } };
  if (eventName === "issue_comment" && !payload.issue?.pull_request && !payload.pull_request) {
    return { status: 200, body: { ok: true, ignored: "not_pr" } };
  }

  const install = await githubInstallForId(installationId);
  if (!install || !install.enabled) return { status: 200, body: { ok: true, ignored: "disabled" } };
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const targets = [...install.mentionTargets, ...(slug ? [slug] : [])];
  if (!githubMentioned(comment.body, targets)) return { status: 200, body: { ok: true, ignored: "mention" } };

  const prNumber = payload.pull_request?.number ?? payload.issue?.number;
  const prUrl = payload.pull_request?.html_url || (payload.repository?.full_name && prNumber
    ? `https://github.com/${payload.repository.full_name}/pull/${prNumber}`
    : comment.html_url || "");
  const created = await createTask(
    install.userId,
    {
      trigger: "github_pr_mention",
      commentId: String(comment.id),
      sourceRef: prUrl,
      payload: {
        repo: payload.repository?.full_name,
        prNumber,
        prUrl,
        commentBody: comment.body,
        commenter: comment.user?.login,
        mentionTargets: targets,
        commentId: String(comment.id),
      },
    },
    "system",
  );
  await handoff(install.userId, created, comment.body, payload.repository?.html_url ?? null);
  return { status: 200, body: { ok: true, taskId: created.task.id, deduped: created.deduped } };
}
