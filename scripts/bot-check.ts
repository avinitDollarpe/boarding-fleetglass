import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  channelAllowed,
  githubMentioned,
  githubMentionTargets,
  githubRepoInScope,
  slackMentioned,
  SLACK_ALIASES,
  SLACK_HANDLE,
} from "../src/lib/bots";
import { ownerMayTrigger, parseSlackEvent, pickSlackConnections, verifySlackSignature } from "../src/lib/slack-event";

assert.equal(slackMentioned("hey @Fleetglass check this", { handle: "Fleetglass", aliases: [] }), true);
assert.equal(slackMentioned("<@U123> please", { handle: "Fleetglass", aliases: [], botUserId: "U123" }), true);
assert.equal(slackMentioned("@Chief the deploy", { handle: "Fleetglass", aliases: ["Chief"] }), true);
assert.equal(slackMentioned("@cursor do it", { handle: "Fleetglass", aliases: ["Chief"] }), false);
assert.equal(slackMentioned("@cursor do it", { handle: SLACK_HANDLE, aliases: [...SLACK_ALIASES] }), true);
assert.equal(slackMentioned("cursor bot please look", { handle: SLACK_HANDLE, aliases: [...SLACK_ALIASES] }), true);
assert.equal(slackMentioned("@cursoragent ship it", { handle: SLACK_HANDLE, aliases: [...SLACK_ALIASES] }), true);
assert.equal(slackMentioned("@Cursor the board", { handle: SLACK_HANDLE, aliases: [...SLACK_ALIASES] }), true);
assert.equal(slackMentioned("email fleetglass@example.com", { handle: "Fleetglass", aliases: [] }), false);

assert.equal(githubMentioned("@fleetglass look", ["fleetglass"]), true);
assert.equal(githubMentioned("@fleetglass[bot] look", ["fleetglass"]), true);
assert.equal(githubMentioned("@cursor look", ["fleetglass", "chakravarti"]), false);
assert.equal(githubMentioned("no mention", []), false);
assert.equal(githubMentioned("@avinitDollarpe please", githubMentionTargets()), true);
assert.equal(githubMentioned("@cursor please", githubMentionTargets()), true);
assert.equal(githubMentioned("@cursoragent please", githubMentionTargets()), true);
assert.equal(githubRepoInScope("DollarPe-Infra/boarding-fleetglass"), true);
assert.equal(githubRepoInScope("avinitDollarpe/notes"), true);
assert.equal(githubRepoInScope("other/repo"), false);

assert.equal(channelAllowed([], "C1", "eng"), true);
assert.equal(channelAllowed(["eng-supervisor"], "C1", "eng-supervisor"), true);
assert.equal(channelAllowed(["C1"], "C1", "random"), true);
assert.equal(channelAllowed(["#eng"], "C9", "eng"), true);
assert.equal(channelAllowed(["eng"], "C9", "ops"), false);
assert.equal(channelAllowed(["*"], "C9", "ops"), true);

const challenge = parseSlackEvent({ type: "url_verification", challenge: "abc123" });
assert.deepEqual(challenge, { action: "challenge", challenge: "abc123" });
const allowed = parseSlackEvent({
  type: "event_callback",
  team_id: "T1",
  api_app_id: "A1",
  event_id: "Ev1",
  authorizations: [{ user_id: "UBOT", is_bot: true }],
  event: { type: "app_mention", user: "U08C40K4FHN", text: "ship it", ts: "1.2", channel: "C1" },
});
assert.equal(allowed.action, "ingest");
assert.equal(ownerMayTrigger("U08C40K4FHN", null, { userIds: ["U08C40K4FHN"], emails: [] }), true);
assert.equal(ownerMayTrigger("U000", "owner@example.com", { userIds: [], emails: ["owner@example.com"] }), true);
assert.equal(ownerMayTrigger("U000", null, { userIds: ["U08C40K4FHN"], emails: [] }), false);
assert.equal(ownerMayTrigger("U000", null, { userIds: [], emails: [] }), false);
const picked = pickSlackConnections(
  [
    { teamId: "T1", apiAppId: "A1", botUserId: "UBOT" },
    { teamId: "T1", apiAppId: "A2", botUserId: "UOTHER" },
    { teamId: "T9", apiAppId: "A1", botUserId: "UBOT" },
  ],
  { teamId: "T1", apiAppId: "A1", botUserIds: ["UBOT"] },
);
assert.equal(picked.length, 1);
assert.equal(picked[0]?.apiAppId, "A1");

const raw = JSON.stringify({ type: "url_verification", challenge: "abc123" });
const ts = String(Math.floor(Date.now() / 1000));
const secret = "chief-signing-secret";
const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
assert.equal(verifySlackSignature(raw, ts, sig, secret), true);
assert.equal(verifySlackSignature(raw, ts, "v0=deadbeef", secret), false);
assert.equal(verifySlackSignature(raw, "1", sig, secret), false);

console.log("bot checks ok");
