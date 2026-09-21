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

const calls: { url: string; body: unknown }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("http://richard.test")) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status: 200 });
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

const gh = {
  action: "created",
  repository: { full_name: "avinitDollarpe/boarding-fleetglass", html_url: "https://github.com/avinitDollarpe/boarding-fleetglass" },
  issue: { number: 7, pull_request: {} },
  comment: { id: 4242, body: "@cursor look at the webhook", user: { login: "avinitDollarpe" } },
};
const ghRaw = JSON.stringify(gh);
const ghFirst = await receiveGithubWebhook(ghRaw, githubSig(ghRaw), "issue_comment");
assert.deepEqual(ghFirst.body, { ok: true, woke: true, deduped: false });
assert.equal(calls.length, 2);
assert.deepEqual(calls[1]?.body, {
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
assert.equal(calls.length, 2);

const unsigned = await receiveGithubWebhook(ghRaw, "sha256=nope", "issue_comment");
assert.equal(unsigned.status, 401);

console.log("wake checks ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
