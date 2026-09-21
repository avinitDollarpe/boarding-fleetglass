import { createHmac, timingSafeEqual } from "crypto";
import { channelAllowed, githubMentioned } from "@/lib/bots";
import { decideSlackEvent, verifySlackSignature, type SlackEventBody } from "@/lib/slack-event";
import { pool } from "@/db/client";
import { createTask, launchTask } from "@/server/fleet";
import { githubInstallForId, slackInstallForTeam } from "@/server/installs";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyGithubSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(raw).digest("hex");
  return safeEqual(signature, `sha256=${digest}`);
}

async function fleetUserForEnvSlack(): Promise<string | null> {
  const configured = process.env.SLACK_FLEETGLASS_USER_ID?.trim();
  if (configured) return configured;
  const email = process.env.SLACK_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  const res = await pool.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1", [email]);
  return res.rows[0]?.id ?? null;
}

async function notifyChief(body: Record<string, unknown>) {
  const url = process.env.CHIEF_HANDOFF_URL?.trim();
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2500),
  }).catch(() => {});
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
  let payload: SlackEventBody;
  try {
    payload = JSON.parse(raw) as SlackEventBody;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const decision = decideSlackEvent(payload);
  if (decision.action === "challenge") return { status: 200, body: { challenge: decision.challenge } };
  if (decision.action === "ignore") return { status: 200, body: { ok: true, ignored: decision.reason } };

  const install = await slackInstallForTeam(decision.teamId);
  if (install && !install.enabled) return { status: 200, body: { ok: true, ignored: "disabled" } };
  if (install && !channelAllowed(install.channelAllowlist, decision.channel, decision.channelName)) {
    return { status: 200, body: { ok: true, ignored: "channel" } };
  }
  const userId = install?.userId ?? (await fleetUserForEnvSlack());
  const token = install?.token || process.env.SLACK_BOT_TOKEN || "";
  if (!userId) return { status: 200, body: { ok: true, ignored: "no_owner" } };
  if (!token) return { status: 200, body: { ok: true, ignored: "no_token" } };

  const permalink = await slackPermalink(token, decision.channel, decision.ts);
  const created = await createTask(
    userId,
    {
      trigger: "slack_bot_mention",
      sourceRef: permalink,
      owner: install?.displayName || "Chief",
      idempotencyKey: decision.eventId ? `slack_event:${decision.eventId}` : undefined,
      payload: {
        teamId: decision.teamId,
        channelId: decision.channel,
        channel: decision.channelName,
        permalink,
        text: decision.text,
        user: decision.user,
        slackTs: decision.ts,
        messageTs: decision.ts,
        eventId: decision.eventId ?? undefined,
      },
    },
    "system",
  );
  await notifyChief({
    type: "fleetglass.slack_mention",
    taskId: created.task.id,
    deduped: created.deduped,
    trigger: "slack_bot_mention",
    sourceRef: permalink,
    slackUser: decision.user,
    slackTs: decision.ts,
    eventId: decision.eventId,
    text: decision.text,
  });
  await handoff(userId, created, decision.text || "Slack mention", null);
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
