import { createHmac, timingSafeEqual } from "crypto";

export function verifySlackSignature(raw: string, timestamp: string | null, signature: string | null, secret: string): boolean {
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex");
  const left = Buffer.from(signature);
  const right = Buffer.from(`v0=${digest}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SlackEventBody = {
  type?: string;
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  authorizations?: { user_id?: string; is_bot?: boolean; team_id?: string }[];
  event?: {
    type?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    channel?: string;
    channel_name?: string;
  };
};

export type SlackDecision =
  | { action: "challenge"; challenge: string }
  | { action: "ignore"; reason: string }
  | {
      action: "ingest";
      teamId: string;
      apiAppId: string | null;
      botUserIds: string[];
      channel: string;
      channelName?: string;
      ts: string;
      threadTs: string;
      user: string;
      text: string;
      eventId: string | null;
    };

export type SlackRouteHint = {
  teamId: string;
  apiAppId: string | null;
  botUserIds: string[];
};

const SLACK_MENTION_TOKEN = /<(?:@[A-Z0-9]+|![^>\n]+)(?:\|[^>\n]*)?>/gi;

/** True when the mention, with Slack mention tokens removed, is exactly `ping`. */
export function isExactSlackPing(text: string): boolean {
  const stripped = text.replace(SLACK_MENTION_TOKEN, " ").replace(/\s+/g, " ").trim();
  return stripped.toLowerCase() === "ping";
}

export function slackRouteHint(payload: SlackEventBody): SlackRouteHint | null {
  const teamId = payload.team_id?.trim() || "";
  if (!teamId) return null;
  const botUserIds = (payload.authorizations ?? [])
    .map((auth) => auth.user_id?.trim() || "")
    .filter(Boolean);
  return { teamId, apiAppId: payload.api_app_id?.trim() || null, botUserIds };
}

/** Classify a Slack body. Signature checks and the owner allowlist happen on the matched connection. */
export function parseSlackEvent(payload: SlackEventBody): SlackDecision {
  if (payload.type === "url_verification") {
    return payload.challenge ? { action: "challenge", challenge: payload.challenge } : { action: "ignore", reason: "challenge" };
  }
  const event = payload.event;
  if (!event || event.type !== "app_mention") return { action: "ignore", reason: "event" };
  if (event.bot_id) return { action: "ignore", reason: "bot" };
  if (!event.user) return { action: "ignore", reason: "mentioner" };
  const hint = slackRouteHint(payload);
  if (!hint || !event.ts || !event.channel) return { action: "ignore", reason: "empty" };
  return {
    action: "ingest",
    teamId: hint.teamId,
    apiAppId: hint.apiAppId,
    botUserIds: hint.botUserIds,
    channel: event.channel,
    channelName: event.channel_name,
    ts: event.ts,
    threadTs: event.thread_ts?.trim() || event.ts,
    user: event.user,
    text: event.text ?? "",
    eventId: payload.event_id ?? null,
  };
}

export function pickSlackConnections<T extends { teamId: string | null; apiAppId: string | null; botUserId: string | null }>(
  connections: T[],
  hint: SlackRouteHint,
): T[] {
  return connections.filter((conn) => {
    if (!conn.teamId || conn.teamId !== hint.teamId) return false;
    if (hint.apiAppId && conn.apiAppId && conn.apiAppId !== hint.apiAppId) return false;
    if (hint.botUserIds.length > 0 && conn.botUserId && !hint.botUserIds.includes(conn.botUserId)) return false;
    return true;
  });
}

/** True when the Slack user id or profile email is on this connection's allowlist. Empty allowlists fail closed. */
export function ownerMayTrigger(
  slackUserId: string,
  email: string | null,
  allow: { userIds: string[]; emails: string[] },
): boolean {
  if (allow.userIds.length === 0 && allow.emails.length === 0) return false;
  if (allow.userIds.some((id) => id === slackUserId)) return true;
  const normalized = email?.trim().toLowerCase() || "";
  if (!normalized) return false;
  return allow.emails.some((owner) => owner.trim().toLowerCase() === normalized);
}
