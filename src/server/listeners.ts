import { createHmac, timingSafeEqual } from "crypto";
import { githubMentioned, githubMentionTargets, githubRepoInScope, SLACK_MENTION_USER_DEFAULT } from "@/lib/bots";
import { normalizeIntake } from "@/lib/intake";
import { isExactSlackPing, parseSlackEvent, verifySlackSignature, type SlackEventBody } from "@/lib/slack-event";
import { claimSlackReply, mintSlackReply, releaseSlackReply, verifySlackReplyRequest } from "@/lib/slack-reply";
import { deliverRichardWake, type RichardBrief, type WakeDelivery } from "@/server/wake";

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

function wakeHttp(delivery: WakeDelivery): { status: number; body: Record<string, unknown> } {
  if (!delivery.ok) return { status: 502, body: { error: delivery.error } };
  if ("reason" in delivery) return { status: 200, body: { ok: true, woke: false, reason: delivery.reason } };
  return { status: 200, body: { ok: true, woke: delivery.woke, deduped: delivery.deduped } };
}

const SLACK_THINKING_STATUS = "is thinking...";
const SLACK_STATUS_TIMEOUT_MS = 2500;

type SlackStatusSurface = "thread" | "session" | "none";

function showSlackThinking(token: string, channel: string, threadTs: string): void {
  void postSlackThinking(token, channel, threadTs);
}

async function slackApi(
  token: string,
  method: string,
  payload: Record<string, string>,
): Promise<{ ok?: boolean; error?: string }> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SLACK_STATUS_TIMEOUT_MS),
  });
  return (await response.json()) as { ok?: boolean; error?: string };
}

/** Fire-and-forget on a wake. A status failure must not change the wake response. */
async function postSlackThinking(token: string, channel: string, threadTs: string): Promise<SlackStatusSurface> {
  try {
    const body = await slackApi(token, "assistant.threads.setStatus", {
      channel_id: channel,
      thread_ts: threadTs,
      status: SLACK_THINKING_STATUS,
    });
    if (body.ok) return "thread";
    if (body.error !== "method_not_supported_for_channel_type") {
      console.error("slack thinking status failed", body.error ?? "not_ok");
      return "none";
    }
    // Session channels reject assistant.threads.setStatus. Omit thread_ts there.
    const fallback = await slackApi(token, "agents.sessions.setStatus", {
      channel_id: channel,
      status: "processing",
    });
    if (!fallback.ok) {
      console.error("slack thinking status failed", fallback.error ?? "not_ok");
      return "none";
    }
    return "session";
  } catch (error) {
    console.error("slack thinking status failed", error instanceof Error ? error.message : "unknown");
    return "none";
  }
}

async function postSlackBotMessage(token: string, channel: string, threadTs: string, text: string): Promise<boolean> {
  try {
    const body = await slackApi(token, "chat.postMessage", {
      channel,
      text,
      thread_ts: threadTs,
    });
    if (body.ok) return true;
    console.error("slack postMessage failed", body.error ?? "not_ok");
    return false;
  } catch (error) {
    console.error("slack postMessage failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

async function clearSlackStatus(
  token: string,
  channel: string,
  threadTs: string,
  surface: "thread" | "session",
): Promise<void> {
  try {
    if (surface === "session") {
      const body = await slackApi(token, "agents.sessions.setStatus", { channel_id: channel, status: "" });
      if (!body.ok) console.error("slack status clear failed", body.error ?? "not_ok");
      return;
    }
    const body = await slackApi(token, "assistant.threads.setStatus", {
      channel_id: channel,
      thread_ts: threadTs,
      status: "",
    });
    if (body.ok) return;
    if (body.error === "method_not_supported_for_channel_type") {
      const fallback = await slackApi(token, "agents.sessions.setStatus", { channel_id: channel, status: "" });
      if (!fallback.ok) console.error("slack status clear failed", fallback.error ?? "not_ok");
      return;
    }
    console.error("slack status clear failed", body.error ?? "not_ok");
  } catch (error) {
    console.error("slack status clear failed", error instanceof Error ? error.message : "unknown");
  }
}

async function answerSlackPing(token: string, channel: string, threadTs: string) {
  if (!token) {
    console.error("slack pong skipped", "no_token");
    return { status: 200, body: { ok: true, woke: false, answered: "pong" } };
  }
  // Status must finish before pong. A setStatus that lands after the message stays on screen.
  const surface = await postSlackThinking(token, channel, threadTs);
  const posted = await postSlackBotMessage(token, channel, threadTs, "pong");
  if (!posted) await clearSlackStatus(token, channel, threadTs, surface === "session" ? "session" : "thread");
  return { status: 200, body: { ok: true, woke: false, answered: "pong" } };
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
  const secret = process.env.SLACK_SIGNING_SECRET?.trim() || "";
  if (!secret) return { status: 503, body: { error: "slack_unconfigured" } };
  if (!verifySlackSignature(raw, timestamp, signature, secret)) return { status: 401, body: { error: "invalid_signature" } };

  let payload: SlackEventBody;
  try {
    payload = JSON.parse(raw) as SlackEventBody;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  if (payload.type === "url_verification") {
    return payload.challenge
      ? { status: 200, body: { challenge: payload.challenge } }
      : { status: 200, body: { ok: true, ignored: "challenge" } };
  }

  const decision = parseSlackEvent(payload);
  if (decision.action !== "ingest") {
    return { status: 200, body: { ok: true, ignored: decision.action === "ignore" ? decision.reason : "event" } };
  }

  const mentionUser = process.env.SLACK_MENTION_USER_ID?.trim() || SLACK_MENTION_USER_DEFAULT;
  if (decision.user !== mentionUser) return { status: 200, body: { ok: true, ignored: "owner" } };
  const botUserId = process.env.SLACK_BOT_USER_ID?.trim() || "";
  if (botUserId && decision.botUserIds.length > 0 && !decision.botUserIds.includes(botUserId)) {
    return { status: 200, body: { ok: true, ignored: "bot" } };
  }

  const token = process.env.SLACK_BOT_TOKEN?.trim() || "";
  if (isExactSlackPing(decision.text)) return answerSlackPing(token, decision.channel, decision.threadTs);
  if (token) showSlackThinking(token, decision.channel, decision.threadTs);
  const permalink = token
    ? await slackPermalink(token, decision.channel, decision.ts)
    : `https://slack.com/archives/${decision.channel}/p${decision.ts.replace(".", "")}`;

  const intake = normalizeIntake({
    trigger: "slack_bot_mention",
    sourceRef: permalink,
    payload: {
      teamId: decision.teamId,
      channelId: decision.channel,
      permalink,
      text: decision.text,
      user: decision.user,
      slackTs: decision.ts,
      eventId: decision.eventId ?? undefined,
    },
  });
  if (!intake.ok || !intake.value.idempotencyKey) return { status: 200, body: { ok: true, ignored: "empty" } };

  const reply = mintSlackReply(decision.channel, decision.threadTs);
  const brief: RichardBrief = {
    type: "fleetglass.wake",
    source: "slack",
    text: decision.text,
    url: permalink,
    author: decision.user,
    ids: {
      slack_ts: decision.ts,
      event_id: decision.eventId,
      team_id: decision.teamId,
      channel_id: decision.channel,
    },
    ...(reply ? { reply } : {}),
  };
  return wakeHttp(await deliverRichardWake(brief, intake.value.idempotencyKey));
}

export async function receiveSlackReply(raw: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const verdict = verifySlackReplyRequest(payload);
  if (!verdict.ok) return { status: verdict.status, body: { error: verdict.error } };
  const token = process.env.SLACK_BOT_TOKEN?.trim() || "";
  if (!token) return { status: 503, body: { error: "slack_unconfigured" } };
  if (!claimSlackReply(verdict.sig, verdict.exp)) return { status: 403, body: { error: "reused" } };
  const posted = await postSlackBotMessage(token, verdict.channelId, verdict.threadTs, verdict.text);
  if (!posted) {
    releaseSlackReply(verdict.sig);
    await clearSlackStatus(token, verdict.channelId, verdict.threadTs, "thread");
    return { status: 502, body: { error: "slack_post_failed" } };
  }
  return { status: 200, body: { ok: true, posted: true } };
}

export async function receiveGithubWebhook(raw: string, signature: string | null, eventName: string | null) {
  if (!process.env.GITHUB_WEBHOOK_SECRET) return { status: 503, body: { error: "github_unconfigured" } };
  if (!verifyGithubSignature(raw, signature)) return { status: 401, body: { error: "invalid_signature" } };
  if (eventName !== "issue_comment" && eventName !== "pull_request_review_comment") {
    return { status: 200, body: { ok: true, ignored: "event" } };
  }

  let payload: {
    action?: string;
    repository?: { full_name?: string; html_url?: string };
    issue?: { number?: number; pull_request?: unknown };
    pull_request?: { number?: number; html_url?: string };
    comment?: { id?: number; body?: string; html_url?: string; user?: { login?: string } };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  if (payload.action && payload.action !== "created") return { status: 200, body: { ok: true, ignored: "action" } };
  const comment = payload.comment;
  if (!comment?.id || !comment.body) return { status: 200, body: { ok: true, ignored: "empty" } };
  if (eventName === "issue_comment" && !payload.issue?.pull_request && !payload.pull_request) {
    return { status: 200, body: { ok: true, ignored: "not_pr" } };
  }

  const repo = payload.repository?.full_name ?? "";
  if (!githubRepoInScope(repo)) return { status: 200, body: { ok: true, ignored: "repo" } };
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const targets = githubMentionTargets(slug ? [slug] : []);
  if (!githubMentioned(comment.body, targets)) return { status: 200, body: { ok: true, ignored: "mention" } };

  const prNumber = payload.pull_request?.number ?? payload.issue?.number ?? null;
  const prUrl =
    payload.pull_request?.html_url ||
    (payload.repository?.full_name && prNumber
      ? `https://github.com/${payload.repository.full_name}/pull/${prNumber}`
      : comment.html_url || "");

  const intake = normalizeIntake({
    trigger: "github_pr_mention",
    commentId: String(comment.id),
    sourceRef: prUrl,
    payload: {
      repo,
      prNumber: prNumber ?? undefined,
      prUrl,
      commentBody: comment.body,
      commenter: comment.user?.login,
      commentId: String(comment.id),
    },
  });
  if (!intake.ok || !intake.value.idempotencyKey) return { status: 200, body: { ok: true, ignored: "empty" } };

  const brief: RichardBrief = {
    type: "fleetglass.wake",
    source: "github",
    text: comment.body,
    url: prUrl,
    author: comment.user?.login ?? "",
    ids: {
      comment_id: String(comment.id),
      repo,
      pr_number: prNumber,
    },
  };
  return wakeHttp(await deliverRichardWake(brief, intake.value.idempotencyKey));
}
