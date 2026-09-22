import { createHmac, timingSafeEqual } from "crypto";

/** Reply links last 15 minutes. */
export const SLACK_REPLY_TTL_SEC = 15 * 60;

export type SlackReplyGrant = {
  url: string;
  channel_id: string;
  thread_ts: string;
  exp: number;
  sig: string;
};

export type SlackReplyVerdict =
  | { ok: true; channelId: string; threadTs: string; text: string; exp: number; sig: string }
  | { ok: false; status: number; error: string };

const usedReplies = new Map<string, number>();

export function fleetglassPublicBase(): string | null {
  const explicit = process.env.FLEETGLASS_PUBLIC_URL?.trim();
  if (!explicit) return null;
  return explicit.replace(/\/+$/, "");
}

function replyHostCanLand(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0") {
    return false;
  }
  if (host.endsWith(".vercel.app") && host.includes("-git-")) return false;
  return true;
}

/** Richard can POST this base. Missing, localhost, and preview hosts cannot. */
export function slackReplyCallbackCanLand(base: string | null = fleetglassPublicBase()): boolean {
  if (!base) return false;
  return replyHostCanLand(base);
}

/** Reply HMAC key. Mint and verify both use this. No signing-secret fallback. */
export function slackReplySecret(): string {
  return process.env.FLEETGLASS_REPLY_SECRET?.trim() || "";
}

export function slackReplyCanonical(channelId: string, threadTs: string, exp: number): string {
  return JSON.stringify(["v1", channelId, threadTs, exp]);
}

export function signSlackReply(channelId: string, threadTs: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(slackReplyCanonical(channelId, threadTs, exp)).digest("hex");
}

export function mintSlackReply(channelId: string, threadTs: string, nowSec = Date.now() / 1000): SlackReplyGrant | null {
  const base = fleetglassPublicBase();
  const secret = slackReplySecret();
  if (!base || !slackReplyCallbackCanLand(base) || !secret || !channelId || !threadTs) return null;
  const exp = Math.floor(nowSec) + SLACK_REPLY_TTL_SEC;
  return {
    url: `${base}/api/slack/reply`,
    channel_id: channelId,
    thread_ts: threadTs,
    exp,
    sig: signSlackReply(channelId, threadTs, exp, secret),
  };
}

function pruneUsedReplies(nowSec: number) {
  if (usedReplies.size < 200) return;
  for (const [sig, exp] of usedReplies) {
    if (nowSec >= exp) usedReplies.delete(sig);
  }
}

/** False when this signature was already accepted and has not expired. */
export function claimSlackReply(sig: string, exp: number, nowSec = Date.now() / 1000): boolean {
  pruneUsedReplies(nowSec);
  const existing = usedReplies.get(sig);
  if (existing !== undefined && nowSec < existing) return false;
  usedReplies.set(sig, exp);
  return true;
}

export function releaseSlackReply(sig: string) {
  usedReplies.delete(sig);
}

export function verifySlackReplyRequest(body: unknown, nowSec = Date.now() / 1000): SlackReplyVerdict {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "invalid_body" };
  const raw = body as Record<string, unknown>;
  const channelId = typeof raw.channel_id === "string" ? raw.channel_id.trim() : "";
  const threadTs = typeof raw.thread_ts === "string" ? raw.thread_ts.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const sig = typeof raw.sig === "string" ? raw.sig.trim() : "";
  const exp = raw.exp;
  if (!channelId || !threadTs) return { ok: false, status: 400, error: "missing_target" };
  if (!text) return { ok: false, status: 400, error: "empty_text" };
  if (typeof exp !== "number" || !Number.isSafeInteger(exp)) return { ok: false, status: 400, error: "missing_exp" };
  if (!sig) return { ok: false, status: 401, error: "invalid_signature" };
  const secret = slackReplySecret();
  if (!secret) return { ok: false, status: 503, error: "reply_unconfigured" };
  if (nowSec >= exp) return { ok: false, status: 401, error: "expired" };
  const expected = signSlackReply(channelId, threadTs, exp, secret);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, error: "invalid_signature" };
  }
  return { ok: true, channelId, threadTs, text, exp, sig };
}
