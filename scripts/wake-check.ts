import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { receiveGithubWebhook, receiveSlackEvent, receiveSlackReply } from "../src/server/listeners";

const slackSecret = "slack-secret";
const githubSecret = "github-secret";
process.env.SLACK_SIGNING_SECRET = slackSecret;
process.env.SLACK_MENTION_USER_ID = "U08C40K4FHN";
process.env.GITHUB_WEBHOOK_SECRET = githubSecret;
delete process.env.SLACK_BOT_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.CHIEF_HANDOFF_AUTHORIZATION;
delete process.env.FLEETGLASS_PUBLIC_URL;
delete process.env.FLEETGLASS_REPLY_SECRET;
delete process.env.VERCEL_URL;

const calls: { url: string; body: unknown; authorization: string | null }[] = [];
const originalFetch = globalThis.fetch;
let slackStatusMode: "ok" | "not_ok" | "throw" | "session" = "ok";
let slackPostMode: "ok" | "not_ok" | "throw" = "ok";
let slackClearThrows = false;

function authHeader(init?: RequestInit): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("authorization");
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === "authorization");
    return found?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record.Authorization ?? record.authorization ?? null;
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const authorization = authHeader(init);
  if (url.startsWith("http://richard.test")) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), authorization });
    const status = url.endsWith("/fail") ? 401 : 200;
    return new Response("{}", { status });
  }
  if (url.startsWith("https://slack.com/api/")) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), authorization });
    if (url.endsWith("/chat.getPermalink")) return new Response(JSON.stringify({ ok: false }), { status: 200 });
    if (url.endsWith("/assistant.threads.setStatus")) {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { status?: string };
      if (payload.status === "" && slackClearThrows) throw new Error("clear down");
      if (slackStatusMode === "throw") throw new Error("setStatus down");
      if (slackStatusMode === "not_ok") {
        return new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 });
      }
      if (slackStatusMode === "session") {
        return new Response(JSON.stringify({ ok: false, error: "method_not_supported_for_channel_type" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith("/chat.postMessage")) {
      if (slackPostMode === "throw") throw new Error("postMessage down");
      if (slackPostMode === "not_ok") {
        return new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, ts: "1710000000.999000" }), { status: 200 });
    }
    if (url.endsWith("/agents.sessions.setStatus")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: "unexpected_method" }), { status: 200 });
  }
  return originalFetch(input, init);
}) as typeof fetch;

function slackSig(raw: string, ts: string) {
  return `v0=${createHmac("sha256", slackSecret).update(`v0:${ts}:${raw}`).digest("hex")}`;
}

function githubSig(raw: string) {
  return `sha256=${createHmac("sha256", githubSecret).update(raw).digest("hex")}`;
}

async function main() {
const ts = String(Math.floor(Date.now() / 1000));
const challengeRaw = JSON.stringify({ type: "url_verification", challenge: "abc123" });
const challenge = await receiveSlackEvent(challengeRaw, ts, slackSig(challengeRaw, ts));
assert.deepEqual(challenge, { status: 200, body: { challenge: "abc123" } });

const bad = await receiveSlackEvent(challengeRaw, ts, "v0=dead");
assert.equal(bad.status, 401);

delete process.env.CHIEF_HANDOFF_URL;
const mention = {
  type: "event_callback",
  team_id: "T1",
  event_id: "Ev1",
  authorizations: [{ user_id: "UBOT", is_bot: true }],
  event: {
    type: "app_mention",
    user: "U08C40K4FHN",
    text: "wake richard",
    ts: "1710000000.000100",
    channel: "C1",
  },
};
const mentionRaw = JSON.stringify(mention);
const quiet = await receiveSlackEvent(mentionRaw, ts, slackSig(mentionRaw, ts));
assert.deepEqual(quiet.body, { ok: true, woke: false, reason: "no_handoff" });
assert.equal(calls.length, 0);

process.env.CHIEF_HANDOFF_URL = "http://richard.test/wake";
const first = await receiveSlackEvent(mentionRaw, ts, slackSig(mentionRaw, ts));
assert.deepEqual(first.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.length, 1);
assert.equal(calls[0]?.authorization, null);
assert.deepEqual(calls[0]?.body, {
  type: "fleetglass.wake",
  source: "slack",
  text: "wake richard",
  url: "https://slack.com/archives/C1/p1710000000000100",
  author: "U08C40K4FHN",
  ids: {
    slack_ts: "1710000000.000100",
    event_id: "Ev1",
    team_id: "T1",
    channel_id: "C1",
  },
});

const second = await receiveSlackEvent(mentionRaw, ts, slackSig(mentionRaw, ts));
assert.deepEqual(second.body, { ok: true, woke: false, deduped: true });
assert.equal(calls.length, 1);

const stranger = {
  ...mention,
  event: { ...mention.event, user: "U000", ts: "1710000000.000200" },
};
const strangerRaw = JSON.stringify(stranger);
const ignored = await receiveSlackEvent(strangerRaw, ts, slackSig(strangerRaw, ts));
assert.deepEqual(ignored.body, { ok: true, ignored: "owner" });

process.env.CHIEF_HANDOFF_AUTHORIZATION = "Bearer routine-key";
const authed = {
  ...mention,
  event: { ...mention.event, text: "authed wake", ts: "1710000000.000300" },
};
const authedRaw = JSON.stringify(authed);
const authedRes = await receiveSlackEvent(authedRaw, ts, slackSig(authedRaw, ts));
assert.deepEqual(authedRes.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.at(-1)?.authorization, "Bearer routine-key");

process.env.CHIEF_HANDOFF_AUTHORIZATION = "  raw-key-no-scheme  ";
const rawAuth = {
  ...mention,
  event: { ...mention.event, text: "raw auth", ts: "1710000000.000400" },
};
const rawAuthRaw = JSON.stringify(rawAuth);
const rawAuthRes = await receiveSlackEvent(rawAuthRaw, ts, slackSig(rawAuthRaw, ts));
assert.deepEqual(rawAuthRes.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.at(-1)?.authorization, "raw-key-no-scheme");

process.env.CHIEF_HANDOFF_URL = "http://richard.test/fail";
process.env.CHIEF_HANDOFF_AUTHORIZATION = "Bearer routine-key";
const failed = {
  ...mention,
  event: { ...mention.event, text: "fail wake", ts: "1710000000.000500" },
};
const failedRaw = JSON.stringify(failed);
const failedRes = await receiveSlackEvent(failedRaw, ts, slackSig(failedRaw, ts));
assert.equal(failedRes.status, 502);
assert.deepEqual(failedRes.body, { error: "wake_failed" });
assert.equal(calls.at(-1)?.authorization, "Bearer routine-key");

process.env.CHIEF_HANDOFF_URL = "http://richard.test/wake";
delete process.env.CHIEF_HANDOFF_AUTHORIZATION;

const gh = {
  action: "created",
  repository: { full_name: "avinitDollarpe/boarding-fleetglass", html_url: "https://github.com/avinitDollarpe/boarding-fleetglass" },
  issue: { number: 7, pull_request: {} },
  comment: { id: 4242, body: "@cursor look at the webhook", user: { login: "avinitDollarpe" } },
};
const ghRaw = JSON.stringify(gh);
const callsBeforeGithub = calls.length;
const ghFirst = await receiveGithubWebhook(ghRaw, githubSig(ghRaw), "issue_comment");
assert.deepEqual(ghFirst.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.length, callsBeforeGithub + 1);
assert.equal(calls.at(-1)?.authorization, null);
assert.deepEqual(calls.at(-1)?.body, {
  type: "fleetglass.wake",
  source: "github",
  text: "@cursor look at the webhook",
  url: "https://github.com/avinitDollarpe/boarding-fleetglass/pull/7",
  author: "avinitDollarpe",
  ids: {
    comment_id: "4242",
    repo: "avinitDollarpe/boarding-fleetglass",
    pr_number: 7,
  },
});
const ghSecond = await receiveGithubWebhook(ghRaw, githubSig(ghRaw), "issue_comment");
assert.deepEqual(ghSecond.body, { ok: true, woke: false, deduped: true });
assert.equal(calls.length, callsBeforeGithub + 1);

const unsigned = await receiveGithubWebhook(ghRaw, "sha256=nope", "issue_comment");
assert.equal(unsigned.status, 401);
assert.equal(calls.some((call) => call.url.includes("assistant.threads.setStatus")), false);

process.env.SLACK_BOT_TOKEN = "xoxb-test";
const thinking = {
  ...mention,
  event_id: "EvThink",
  event: { ...mention.event, text: "think", ts: "1710000000.000300", channel: "C9" },
};
const thinkingRaw = JSON.stringify(thinking);
const thought = await receiveSlackEvent(thinkingRaw, ts, slackSig(thinkingRaw, ts));
assert.deepEqual(thought.body, { ok: true, woke: true, deduped: false });
const statusCall = calls.find((call) => call.url === "https://slack.com/api/assistant.threads.setStatus");
assert.ok(statusCall);
assert.equal(statusCall.authorization, "Bearer xoxb-test");
assert.deepEqual(statusCall.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000300",
  status: "is thinking...",
});
assert.equal(calls.filter((call) => call.url.startsWith("http://richard.test")).length, 6);

const threaded = {
  ...thinking,
  event_id: "EvThread",
  event: {
    ...thinking.event,
    ts: "1710000000.000400",
    thread_ts: "1710000000.000010",
  },
};
const threadedRaw = JSON.stringify(threaded);
const threadedWake = await receiveSlackEvent(threadedRaw, ts, slackSig(threadedRaw, ts));
assert.deepEqual(threadedWake.body, { ok: true, woke: true, deduped: false });
const threadStatuses = calls.filter(
  (call) =>
    call.url === "https://slack.com/api/assistant.threads.setStatus" &&
    (call.body as { thread_ts?: string }).thread_ts === "1710000000.000010",
);
assert.deepEqual(threadStatuses[0]?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "is thinking...",
});
assert.deepEqual(threadStatuses.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "",
});

slackStatusMode = "throw";
const thrown = {
  ...thinking,
  event_id: "EvThrow",
  event: { ...thinking.event, ts: "1710000000.000500" },
};
const thrownRaw = JSON.stringify(thrown);
const thrownWake = await receiveSlackEvent(thrownRaw, ts, slackSig(thrownRaw, ts));
assert.deepEqual(thrownWake.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.filter((call) => call.url.startsWith("http://richard.test")).length, 8);

slackStatusMode = "not_ok";
const denied = {
  ...thinking,
  event_id: "EvDeny",
  event: { ...thinking.event, ts: "1710000000.000600" },
};
const deniedRaw = JSON.stringify(denied);
const deniedWake = await receiveSlackEvent(deniedRaw, ts, slackSig(deniedRaw, ts));
assert.deepEqual(deniedWake.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.filter((call) => call.url.startsWith("http://richard.test")).length, 9);

slackStatusMode = "session";
const session = {
  ...thinking,
  event_id: "EvSession",
  event: { ...thinking.event, ts: "1710000000.000700", channel: "D1" },
};
const sessionRaw = JSON.stringify(session);
const beforeSession = calls.length;
const sessionWake = await receiveSlackEvent(sessionRaw, ts, slackSig(sessionRaw, ts));
assert.deepEqual(sessionWake.body, { ok: true, woke: true, deduped: false });
const sessionCalls = calls.slice(beforeSession);
const sessionStatuses = sessionCalls.filter((call) => call.url.endsWith("/agents.sessions.setStatus"));
assert.deepEqual(
  sessionStatuses.map((call) => call.body),
  [
    { channel_id: "D1", status: "processing" },
    { channel_id: "D1", status: "" },
  ],
);
assert.equal("thread_ts" in ((sessionStatuses[0]?.body as object) ?? {}), false);

const ghWithToken = {
  ...gh,
  comment: { ...gh.comment, id: 4243, body: "@cursor still no slack status" },
};
const ghWithTokenRaw = JSON.stringify(ghWithToken);
const beforeGh = calls.length;
const ghTokenWake = await receiveGithubWebhook(ghWithTokenRaw, githubSig(ghWithTokenRaw), "issue_comment");
assert.deepEqual(ghTokenWake.body, { ok: true, woke: true, deduped: false });
assert.equal(
  calls.slice(beforeGh).some((call) => call.url.includes("slack.com")),
  false,
);

const strangerWithToken = {
  ...thinking,
  event: { ...thinking.event, user: "U000", ts: "1710000000.000800" },
};
const strangerWithTokenRaw = JSON.stringify(strangerWithToken);
const beforeStranger = calls.length;
const strangerToken = await receiveSlackEvent(strangerWithTokenRaw, ts, slackSig(strangerWithTokenRaw, ts));
assert.deepEqual(strangerToken.body, { ok: true, ignored: "owner" });
assert.equal(calls.length, beforeStranger);

slackStatusMode = "ok";
slackPostMode = "ok";
slackClearThrows = false;
const handoffs = () => calls.filter((call) => call.url.startsWith("http://richard.test")).length;

function slackMention(partial: {
  text: string;
  ts: string;
  channel?: string;
  thread_ts?: string;
  user?: string;
  event_id?: string;
}) {
  return {
    type: "event_callback",
    team_id: "T1",
    event_id: partial.event_id ?? `Ev${partial.ts}`,
    authorizations: [{ user_id: "UBOT", is_bot: true }],
    event: {
      type: "app_mention",
      user: partial.user ?? "U08C40K4FHN",
      text: partial.text,
      ts: partial.ts,
      channel: partial.channel ?? "C9",
      ...(partial.thread_ts ? { thread_ts: partial.thread_ts } : {}),
    },
  };
}

async function postMention(partial: Parameters<typeof slackMention>[0]) {
  const raw = JSON.stringify(slackMention(partial));
  return receiveSlackEvent(raw, ts, slackSig(raw, ts));
}

const beforePing = handoffs();
const beforePingCalls = calls.length;
const ping = await postMention({ text: "<@UBOT> ping", ts: "1710000000.001000", thread_ts: "1710000000.000010" });
assert.equal(ping.status, 200);
assert.deepEqual(ping.body, { ok: true, woke: false, answered: "pong" });
assert.equal(handoffs(), beforePing);
const pingCalls = calls.slice(beforePingCalls);
assert.deepEqual(
  pingCalls.map((call) => call.url),
  ["https://slack.com/api/assistant.threads.setStatus", "https://slack.com/api/chat.postMessage"],
);
assert.equal(pingCalls[0]?.authorization, "Bearer xoxb-test");
assert.deepEqual(pingCalls[0]?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "is thinking...",
});
assert.equal(pingCalls[1]?.authorization, "Bearer xoxb-test");
assert.deepEqual(pingCalls[1]?.body, {
  channel: "C9",
  text: "pong",
  thread_ts: "1710000000.000010",
});

const cased = await postMention({ text: "<@UBOT|Richard>  PING", ts: "1710000000.001100" });
assert.deepEqual(cased.body, { ok: true, woke: false, answered: "pong" });
assert.equal(handoffs(), beforePing);
const casedPost = calls.at(-1);
assert.deepEqual(casedPost?.body, {
  channel: "C9",
  text: "pong",
  thread_ts: "1710000000.001100",
});

const notPing = await postMention({ text: "<@UBOT> ping please", ts: "1710000000.001200", thread_ts: "1710000000.000010" });
assert.deepEqual(notPing.body, { ok: true, woke: true, deduped: false });
assert.equal(handoffs(), beforePing + 1);
const notPingBrief = calls.filter((call) => call.url.startsWith("http://richard.test")).at(-1)?.body as object;
assert.equal("reply" in (notPingBrief ?? {}), false);

const strangerPing = await postMention({ text: "<@UBOT> ping", ts: "1710000000.001300", user: "U000" });
assert.deepEqual(strangerPing.body, { ok: true, ignored: "owner" });
assert.equal(handoffs(), beforePing + 1);

process.env.SLACK_MENTION_USER_ID = "UOWNER2";
const overridden = await postMention({ text: "ping", ts: "1710000000.001400", user: "U08C40K4FHN" });
assert.deepEqual(overridden.body, { ok: true, ignored: "owner" });
const owner2 = await postMention({ text: "ping", ts: "1710000000.001500", user: "UOWNER2" });
assert.deepEqual(owner2.body, { ok: true, woke: false, answered: "pong" });
process.env.SLACK_MENTION_USER_ID = "U08C40K4FHN";
assert.equal(handoffs(), beforePing + 1);

process.env.SLACK_BOT_USER_ID = "UOTHER";
const wrongBot = await postMention({ text: "ping", ts: "1710000000.001600" });
assert.deepEqual(wrongBot.body, { ok: true, ignored: "bot" });
delete process.env.SLACK_BOT_USER_ID;
assert.equal(handoffs(), beforePing + 1);

slackPostMode = "throw";
const beforeThrow = calls.length;
const thrownPong = await postMention({ text: "ping", ts: "1710000000.001700", thread_ts: "1710000000.000010" });
assert.equal(thrownPong.status, 200);
assert.deepEqual(thrownPong.body, { ok: true, woke: false, answered: "pong" });
assert.equal(handoffs(), beforePing + 1);
const throwSlice = calls.slice(beforeThrow);
assert.deepEqual(
  throwSlice.map((call) => call.url),
  [
    "https://slack.com/api/assistant.threads.setStatus",
    "https://slack.com/api/chat.postMessage",
    "https://slack.com/api/assistant.threads.setStatus",
  ],
);
assert.deepEqual(throwSlice[0]?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "is thinking...",
});
assert.deepEqual(throwSlice[2]?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "",
});

slackPostMode = "not_ok";
const beforeDeny = calls.length;
const deniedPong = await postMention({ text: "ping", ts: "1710000000.001800", channel: "C4" });
assert.equal(deniedPong.status, 200);
assert.deepEqual(deniedPong.body, { ok: true, woke: false, answered: "pong" });
const denySlice = calls.slice(beforeDeny);
assert.deepEqual(denySlice.at(-1)?.body, { channel_id: "C4", thread_ts: "1710000000.001800", status: "" });
assert.equal(handoffs(), beforePing + 1);

slackPostMode = "not_ok";
slackStatusMode = "session";
const beforeSessionPing = calls.length;
const sessionPong = await postMention({ text: "ping", ts: "1710000000.001900", channel: "D9" });
assert.equal(sessionPong.status, 200);
const sessionSlice = calls.slice(beforeSessionPing);
assert.deepEqual(
  sessionSlice.map((call) => call.url),
  [
    "https://slack.com/api/assistant.threads.setStatus",
    "https://slack.com/api/agents.sessions.setStatus",
    "https://slack.com/api/chat.postMessage",
    "https://slack.com/api/agents.sessions.setStatus",
  ],
);
assert.deepEqual(sessionSlice[1]?.body, { channel_id: "D9", status: "processing" });
assert.deepEqual(sessionSlice[3]?.body, { channel_id: "D9", status: "" });
assert.equal(handoffs(), beforePing + 1);

slackStatusMode = "ok";
slackPostMode = "throw";
slackClearThrows = true;
const clearBoom = await postMention({ text: "ping", ts: "1710000000.002000" });
assert.equal(clearBoom.status, 200);
assert.deepEqual(clearBoom.body, { ok: true, woke: false, answered: "pong" });
slackClearThrows = false;
slackPostMode = "ok";

delete process.env.SLACK_BOT_TOKEN;
const quietPing = await postMention({ text: "ping", ts: "1710000000.002100" });
assert.equal(quietPing.status, 200);
assert.deepEqual(quietPing.body, { ok: true, woke: false, answered: "pong" });
assert.equal(handoffs(), beforePing + 1);
process.env.SLACK_BOT_TOKEN = "xoxb-test";

process.env.FLEETGLASS_PUBLIC_URL = "https://fleetglass.example/";
process.env.FLEETGLASS_REPLY_SECRET = "reply-secret";
const beforeAsk = calls.length;
const ask = await postMention({
  text: "ship the api",
  ts: "1710000000.002200",
  thread_ts: "1710000000.000010",
  event_id: "EvAsk",
});
assert.deepEqual(ask.body, { ok: true, woke: true, deduped: false });
const askCalls = calls.slice(beforeAsk);
assert.equal(askCalls.some((call) => call.url.endsWith("/chat.postMessage")), false);
assert.equal(
  askCalls.some(
    (call) =>
      call.url.endsWith("/assistant.threads.setStatus") && (call.body as { status?: string }).status === "is thinking...",
  ),
  true,
);
assert.equal(
  askCalls.some(
    (call) => call.url.endsWith("/assistant.threads.setStatus") && (call.body as { status?: string }).status === "",
  ),
  false,
);
const askBrief = askCalls.find((call) => call.url === "http://richard.test/wake")?.body as {
  reply?: { url: string; exp: number; sig: string };
  text?: string;
};
const replyExp = Math.floor(Date.now() / 1000) + 15 * 60;
assert.equal(askBrief.text, "ship the api");
assert.equal(askBrief.reply?.url, "https://fleetglass.example/api/slack/reply");
assert.ok(askBrief.reply && Math.abs(askBrief.reply.exp - replyExp) <= 2);
const replySig = (channel: string, thread: string, exp: number, secret: string) =>
  createHmac("sha256", secret).update(JSON.stringify(["v1", channel, thread, exp])).digest("hex");
assert.equal(askBrief.reply?.sig, replySig("C9", "1710000000.000010", askBrief.reply!.exp, "reply-secret"));

delete process.env.FLEETGLASS_PUBLIC_URL;
process.env.VERCEL_URL = "fleetglass-abc.vercel.app";
const vercelAsk = await postMention({ text: "use vercel host", ts: "1710000000.002300" });
assert.deepEqual(vercelAsk.body, { ok: true, woke: true, deduped: false });
const vercelBrief = calls.at(-1)?.body as { reply?: { url: string; sig: string; exp: number } };
assert.equal(vercelBrief.reply?.url, "https://fleetglass-abc.vercel.app/api/slack/reply");
assert.equal(
  vercelBrief.reply?.sig,
  replySig("C9", "1710000000.002300", vercelBrief.reply!.exp, "reply-secret"),
);
delete process.env.VERCEL_URL;

delete process.env.FLEETGLASS_REPLY_SECRET;
process.env.FLEETGLASS_PUBLIC_URL = "https://fleetglass.example";
const fallbackAsk = await postMention({ text: "secret fallback", ts: "1710000000.002400", thread_ts: "1710000000.000010" });
const fallbackBrief = calls.at(-1)?.body as { reply?: { sig: string; exp: number } };
assert.equal(
  fallbackBrief.reply?.sig,
  replySig("C9", "1710000000.000010", fallbackBrief.reply!.exp, slackSecret),
);
process.env.FLEETGLASS_REPLY_SECRET = "reply-secret";

delete process.env.FLEETGLASS_PUBLIC_URL;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_ENV;
const beforeBare = calls.length;
const bareAsk = await postMention({ text: "no callback", ts: "1710000000.002500" });
assert.deepEqual(bareAsk.body, { ok: true, woke: true, deduped: false });
const bareSlice = calls.slice(beforeBare);
const bareBrief = bareSlice.find((call) => call.url === "http://richard.test/wake")?.body as { reply?: unknown };
assert.equal(bareBrief.reply, undefined);
assert.deepEqual(
  bareSlice
    .filter((call) => call.url.endsWith("/assistant.threads.setStatus"))
    .map((call) => (call.body as { status?: string }).status),
  ["is thinking...", ""],
);
assert.deepEqual(bareSlice.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.002500",
  status: "",
});

process.env.FLEETGLASS_PUBLIC_URL = "http://127.0.0.1:3000";
const beforeLocal = calls.length;
const localAsk = await postMention({
  text: "local callback",
  ts: "1710000000.002600",
  thread_ts: "1710000000.000010",
});
assert.deepEqual(localAsk.body, { ok: true, woke: true, deduped: false });
const localSlice = calls.slice(beforeLocal);
const localBrief = localSlice.find((call) => call.url === "http://richard.test/wake")?.body as {
  reply?: { url?: string };
};
assert.equal(localBrief.reply?.url, "http://127.0.0.1:3000/api/slack/reply");
assert.deepEqual(localSlice.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "",
});

process.env.FLEETGLASS_PUBLIC_URL = "https://boarding-fleetglass-git-preview-dollarpe.vercel.app";
const beforePreview = calls.length;
const previewAsk = await postMention({ text: "preview callback", ts: "1710000000.002700" });
assert.deepEqual(previewAsk.body, { ok: true, woke: true, deduped: false });
const previewSlice = calls.slice(beforePreview);
const previewBrief = previewSlice.find((call) => call.url === "http://richard.test/wake")?.body as {
  reply?: { url?: string };
};
assert.equal(
  previewBrief.reply?.url,
  "https://boarding-fleetglass-git-preview-dollarpe.vercel.app/api/slack/reply",
);
assert.deepEqual(previewSlice.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.002700",
  status: "",
});

delete process.env.FLEETGLASS_PUBLIC_URL;
process.env.VERCEL_ENV = "preview";
process.env.VERCEL_URL = "boarding-fleetglass-abc123-dollarpe.vercel.app";
const beforePreviewEnv = calls.length;
const previewEnvAsk = await postMention({ text: "preview env", ts: "1710000000.002800" });
assert.deepEqual(previewEnvAsk.body, { ok: true, woke: true, deduped: false });
const previewEnvSlice = calls.slice(beforePreviewEnv);
const previewEnvBrief = previewEnvSlice.find((call) => call.url === "http://richard.test/wake")?.body as {
  reply?: { url?: string };
};
assert.equal(
  previewEnvBrief.reply?.url,
  "https://boarding-fleetglass-abc123-dollarpe.vercel.app/api/slack/reply",
);
assert.deepEqual(previewEnvSlice.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.002800",
  status: "",
});
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_URL;

process.env.FLEETGLASS_PUBLIC_URL = "not-a-url";
const beforeBadUrl = calls.length;
const badUrlAsk = await postMention({ text: "bad public url", ts: "1710000000.002900" });
assert.deepEqual(badUrlAsk.body, { ok: true, woke: true, deduped: false });
const badUrlSlice = calls.slice(beforeBadUrl);
assert.deepEqual(badUrlSlice.at(-1)?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.002900",
  status: "",
});

process.env.VERCEL_ENV = "preview";
process.env.FLEETGLASS_PUBLIC_URL = "https://boarding-fleetglass.vercel.app";
const beforeProdOnPreview = calls.length;
const prodOnPreview = await postMention({ text: "production url", ts: "1710000000.003000" });
assert.deepEqual(prodOnPreview.body, { ok: true, woke: true, deduped: false });
const prodOnPreviewSlice = calls.slice(beforeProdOnPreview);
const prodOnPreviewBrief = prodOnPreviewSlice.find((call) => call.url === "http://richard.test/wake")?.body as {
  reply?: { url?: string };
};
assert.equal(prodOnPreviewBrief.reply?.url, "https://boarding-fleetglass.vercel.app/api/slack/reply");
assert.equal(
  prodOnPreviewSlice.some((call) => (call.body as { status?: string }).status === ""),
  false,
);
delete process.env.VERCEL_ENV;
process.env.FLEETGLASS_PUBLIC_URL = "https://fleetglass.example";

const ghNoReply = {
  ...gh,
  comment: { ...gh.comment, id: 4244, body: "@cursor no slack reply field" },
};
const ghNoReplyRaw = JSON.stringify(ghNoReply);
const ghNoReplyWake = await receiveGithubWebhook(ghNoReplyRaw, githubSig(ghNoReplyRaw), "issue_comment");
assert.deepEqual(ghNoReplyWake.body, { ok: true, woke: true, deduped: false });
assert.equal("reply" in ((calls.at(-1)?.body as object) ?? {}), false);

const thread = "1710000000.000010";
const liveExp = Math.floor(Date.now() / 1000) + 900;
const liveSig = replySig("C9", thread, liveExp, "reply-secret");
const liveBody = JSON.stringify({ text: "shipped", channel_id: "C9", thread_ts: thread, exp: liveExp, sig: liveSig });
const beforeReply = calls.length;
const posted = await receiveSlackReply(liveBody);
assert.deepEqual(posted, { status: 200, body: { ok: true, posted: true } });
const replyPost = calls.slice(beforeReply).find((call) => call.url.endsWith("/chat.postMessage"));
assert.equal(replyPost?.authorization, "Bearer xoxb-test");
assert.deepEqual(replyPost?.body, { channel: "C9", text: "shipped", thread_ts: thread });
assert.equal(calls.slice(beforeReply).some((call) => String((call.body as { status?: string }).status) === ""), false);
const reused = await receiveSlackReply(liveBody);
assert.equal(reused.status, 403);
assert.deepEqual(reused.body, { error: "reused" });
assert.equal(calls.filter((call) => call.url.endsWith("/chat.postMessage") && (call.body as { text?: string }).text === "shipped").length, 1);

const staleExp = Math.floor(Date.now() / 1000) - 5;
const staleBody = JSON.stringify({
  text: "late",
  channel_id: "C9",
  thread_ts: thread,
  exp: staleExp,
  sig: replySig("C9", thread, staleExp, "reply-secret"),
});
const beforeStale = calls.length;
const stale = await receiveSlackReply(staleBody);
assert.equal(stale.status, 401);
assert.deepEqual(stale.body, { error: "expired" });
assert.equal(calls.length, beforeStale);

const badExp = liveExp;
const badBody = JSON.stringify({
  text: "nope",
  channel_id: "C9",
  thread_ts: thread,
  exp: badExp,
  sig: "ab".repeat(32),
});
const beforeBad = calls.length;
const badSig = await receiveSlackReply(badBody);
assert.equal(badSig.status, 401);
assert.deepEqual(badSig.body, { error: "invalid_signature" });
assert.equal(calls.length, beforeBad);

const retargetExp = Math.floor(Date.now() / 1000) + 900;
const retargetBody = JSON.stringify({
  text: "stolen",
  channel_id: "CEVIL",
  thread_ts: thread,
  exp: retargetExp,
  sig: replySig("C9", thread, retargetExp, "reply-secret"),
});
const beforeRetarget = calls.length;
const retarget = await receiveSlackReply(retargetBody);
assert.equal(retarget.status, 401);
assert.deepEqual(retarget.body, { error: "invalid_signature" });
assert.equal(calls.length, beforeRetarget);

const empty = await receiveSlackReply(JSON.stringify({ text: "  ", channel_id: "C9", thread_ts: thread, exp: liveExp, sig: liveSig }));
assert.equal(empty.status, 400);
const missing = await receiveSlackReply(JSON.stringify({ text: "hi", exp: liveExp, sig: liveSig }));
assert.equal(missing.status, 400);

slackPostMode = "not_ok";
const retryExp = Math.floor(Date.now() / 1000) + 900;
const retrySig = replySig("C2", thread, retryExp, "reply-secret");
const retryBody = JSON.stringify({ text: "again", channel_id: "C2", thread_ts: thread, exp: retryExp, sig: retrySig });
const beforeFailReply = calls.length;
const failedReply = await receiveSlackReply(retryBody);
assert.equal(failedReply.status, 502);
assert.deepEqual(failedReply.body, { error: "slack_post_failed" });
const failReplySlice = calls.slice(beforeFailReply);
assert.deepEqual(failReplySlice.at(-1)?.body, { channel_id: "C2", thread_ts: thread, status: "" });
slackPostMode = "ok";
const retried = await receiveSlackReply(retryBody);
assert.deepEqual(retried, { status: 200, body: { ok: true, posted: true } });
assert.deepEqual(calls.at(-1)?.body, { channel: "C2", text: "again", thread_ts: thread });

delete process.env.SLACK_BOT_TOKEN;
const noTokenExp = Math.floor(Date.now() / 1000) + 900;
const noToken = await receiveSlackReply(
  JSON.stringify({
    text: "needs token",
    channel_id: "C9",
    thread_ts: thread,
    exp: noTokenExp,
    sig: replySig("C9", thread, noTokenExp, "reply-secret"),
  }),
);
assert.equal(noToken.status, 503);
process.env.SLACK_BOT_TOKEN = "xoxb-test";

console.log("wake checks ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
