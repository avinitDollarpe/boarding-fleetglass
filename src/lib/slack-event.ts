import { createHmac, timingSafeEqual } from "crypto";

/** Slack user who may mention Richard. Override with SLACK_MENTION_USER_ID. */
export const CHIEF_SLACK_USER_ID = "U08C40K4FHN";

export function allowedSlackMentioner(): string {
  return process.env.SLACK_MENTION_USER_ID?.trim() || CHIEF_SLACK_USER_ID;
}

export function verifySlackSignature(raw: string, timestamp: string | null, signature: string | null, secret = process.env.SLACK_SIGNING_SECRET): boolean {
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
  event_id?: string;
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

export type SlackDecision =
  | { action: "challenge"; challenge: string }
  | { action: "ignore"; reason: string }
  | {
      action: "ingest";
      teamId: string;
      channel: string;
      channelName?: string;
      ts: string;
      user: string;
      text: string;
      eventId: string | null;
    };

/** Decide what a verified Slack event should do. app_mention is kept only for Richard's mentioner. */
export function decideSlackEvent(payload: SlackEventBody, mentioner = allowedSlackMentioner()): SlackDecision {
  if (payload.type === "url_verification") {
    return payload.challenge ? { action: "challenge", challenge: payload.challenge } : { action: "ignore", reason: "challenge" };
  }
  const event = payload.event;
  if (!event || event.type !== "app_mention") return { action: "ignore", reason: "event" };
  if (event.bot_id) return { action: "ignore", reason: "bot" };
  if (!event.user || event.user !== mentioner) return { action: "ignore", reason: "mentioner" };
  if (!payload.team_id || !event.ts || !event.channel) return { action: "ignore", reason: "empty" };
  return {
    action: "ingest",
    teamId: payload.team_id,
    channel: event.channel,
    channelName: event.channel_name,
    ts: event.ts,
    user: event.user,
    text: event.text ?? "",
    eventId: payload.event_id ?? null,
  };
}
