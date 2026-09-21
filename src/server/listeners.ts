import { createHmac, timingSafeEqual } from "crypto";
import { channelAllowed, githubMentioned, githubMentionTargets, githubRepoInScope } from "@/lib/bots";
import { ownerMayTrigger, parseSlackEvent, pickSlackConnections, slackRouteHint, verifySlackSignature, type SlackEventBody } from "@/lib/slack-event";
import { pool } from "@/db/client";
import { createTask, launchTask } from "@/server/fleet";
import { githubInstallForId, listSlackSigningConnections, slackConnectionsForTeam, type SlackSecretConnection } from "@/server/installs";

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

async function fleetUserByEnv(idEnv: string, emailEnv: string): Promise<string | null> {
  const configured = process.env[idEnv]?.trim();
  if (configured) return configured;
  const email = process.env[emailEnv]?.trim().toLowerCase();
  if (!email) return null;
  const res = await pool.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1", [email]);
  return res.rows[0]?.id ?? null;
}

async function fleetUserForEnvGithub(): Promise<string | null> {
  return fleetUserByEnv("GITHUB_FLEETGLASS_USER_ID", "GITHUB_OWNER_EMAIL");
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

function matchingSecret(connections: SlackSecretConnection[], raw: string, timestamp: string | null, signature: string | null) {
  return connections.find((conn) => verifySlackSignature(raw, timestamp, signature, conn.signingSecret)) ?? null;
}

async function slackProfileEmail(token: string, slackUserId: string): Promise<string | null> {
  if (!token) return null;
  try {
    const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    const body = (await response.json()) as { ok?: boolean; user?: { profile?: { email?: string } } };
    return body.ok && body.user?.profile?.email ? body.user.profile.email : null;
  } catch {
    return null;
  }
}

export async function receiveSlackEvent(raw: string, timestamp: string | null, signature: string | null) {
  let payload: SlackEventBody;
  try {
    payload = JSON.parse(raw) as SlackEventBody;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  if (payload.type === "url_verification") {
    const connections = await listSlackSigningConnections();
    if (connections.length === 0) return { status: 503, body: { error: "slack_unconfigured" } };
    if (!matchingSecret(connections, raw, timestamp, signature)) return { status: 401, body: { error: "invalid_signature" } };
    return payload.challenge
      ? { status: 200, body: { challenge: payload.challenge } }
      : { status: 200, body: { ok: true, ignored: "challenge" } };
  }

  const hint = slackRouteHint(payload);
  const connections = hint ? pickSlackConnections(await slackConnectionsForTeam(hint.teamId), hint) : await listSlackSigningConnections();
  if (connections.length === 0) return { status: 200, body: { ok: true, ignored: "no_connection" } };
  const install = matchingSecret(connections, raw, timestamp, signature);
  if (!install) return { status: 401, body: { error: "invalid_signature" } };

  const decision = parseSlackEvent(payload);
  if (decision.action !== "ingest") return { status: 200, body: { ok: true, ignored: decision.action === "ignore" ? decision.reason : "event" } };
  if (!install.enabled) return { status: 200, body: { ok: true, ignored: "disabled" } };
  if (!channelAllowed(install.channelAllowlist, decision.channel, decision.channelName)) {
    return { status: 200, body: { ok: true, ignored: "channel" } };
  }
  const email = install.ownerSlackUserIds.includes(decision.user)
    ? null
    : await slackProfileEmail(install.botToken, decision.user);
  if (!ownerMayTrigger(decision.user, email, { userIds: install.ownerSlackUserIds, emails: install.ownerEmails })) {
    return { status: 200, body: { ok: true, ignored: "owner" } };
  }
  if (!install.botToken) return { status: 200, body: { ok: true, ignored: "no_token" } };

  const permalink = await slackPermalink(install.botToken, decision.channel, decision.ts);
  const created = await createTask(
    install.userId,
    {
      trigger: "slack_bot_mention",
      sourceRef: permalink,
      owner: install.displayName,
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
        apiAppId: decision.apiAppId,
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
  await handoff(install.userId, created, decision.text || "Slack mention", null);
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
  if (!comment?.id || !comment.body) return { status: 200, body: { ok: true, ignored: "empty" } };
  if (eventName === "issue_comment" && !payload.issue?.pull_request && !payload.pull_request) {
    return { status: 200, body: { ok: true, ignored: "not_pr" } };
  }

  const repo = payload.repository?.full_name ?? "";
  if (!githubRepoInScope(repo)) return { status: 200, body: { ok: true, ignored: "repo" } };
  const install = installationId ? await githubInstallForId(installationId) : null;
  if (install && !install.enabled) return { status: 200, body: { ok: true, ignored: "disabled" } };
  const userId = install?.userId ?? (await fleetUserForEnvGithub());
  if (!userId) return { status: 200, body: { ok: true, ignored: "no_owner" } };
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const targets = githubMentionTargets([...(install?.mentionTargets ?? []), ...(slug ? [slug] : [])]);
  if (!githubMentioned(comment.body, targets)) return { status: 200, body: { ok: true, ignored: "mention" } };

  const prNumber = payload.pull_request?.number ?? payload.issue?.number;
  const prUrl = payload.pull_request?.html_url || (payload.repository?.full_name && prNumber
    ? `https://github.com/${payload.repository.full_name}/pull/${prNumber}`
    : comment.html_url || "");
  const created = await createTask(
    userId,
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
  await handoff(userId, created, comment.body, payload.repository?.html_url ?? null);
  return { status: 200, body: { ok: true, taskId: created.task.id, deduped: created.deduped } };
}
