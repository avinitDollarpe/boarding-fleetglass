import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { receiveGithubWebhook, receiveSlackEvent } from "../src/server/listeners";

const slackSecret = "slack-secret";
const githubSecret = "github-secret";
process.env.SLACK_SIGNING_SECRET = slackSecret;
process.env.SLACK_MENTION_USER_ID = "U08C40K4FHN";
process.env.GITHUB_WEBHOOK_SECRET = githubSecret;
delete process.env.SLACK_BOT_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.CHIEF_HANDOFF_AUTHORIZATION;

const calls: { url: string; body: unknown; authorization: string | null }[] = [];
const originalFetch = globalThis.fetch;
let slackStatusMode: "ok" | "not_ok" | "throw" | "session" = "ok";

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
const threadStatus = calls.filter((call) => call.url === "https://slack.com/api/assistant.threads.setStatus").at(-1);
assert.deepEqual(threadStatus?.body, {
  channel_id: "C9",
  thread_ts: "1710000000.000010",
  status: "is thinking...",
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
const sessionStatus = sessionCalls.find((call) => call.url.endsWith("/agents.sessions.setStatus"));
assert.deepEqual(sessionStatus?.body, { channel_id: "D1", status: "processing" });
assert.equal("thread_ts" in ((sessionStatus?.body as object) ?? {}), false);

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

console.log("wake checks ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
