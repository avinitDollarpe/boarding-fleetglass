import assert from "node:assert/strict";
import { decideIntake, normalizeIntake, normalizeSourceRef } from "../src/lib/intake";

const first = normalizeIntake({
  trigger: "github_pr_mention",
  commentId: "99",
  sourceRef: "https://GitHub.com/Org/Repo/pull/12/",
  payload: { commentBody: "please look", commenter: "ada", mentionTargets: ["cursor"] },
});
assert.equal(first.ok, true);
if (!first.ok) process.exit(1);
assert.equal(first.value.idempotencyKey, "github_comment:99");
assert.equal(first.value.sourceRef, "https://github.com/org/repo/pull/12");
assert.equal(first.value.source, "github_pr_mention");

const repeat = decideIntake(first.value, {
  byKey: { id: "task-1", parentId: null },
  byPr: { id: "task-1", parentId: null },
});
assert.deepEqual(repeat, { action: "dedupe", taskId: "task-1" });

const follow = decideIntake(
  { ...first.value, idempotencyKey: "github_comment:100" },
  { byKey: null, byPr: { id: "task-1", parentId: null } },
);
assert.deepEqual(follow, { action: "follow_up", parentId: "task-1" });

const slack = normalizeIntake({
  source: "slack_bot_mention",
  payload: { teamId: "T1", channelId: "C1", messageTs: "1.2", text: "ship it", permalink: "https://slack.example/a" },
});
assert.equal(slack.ok, true);
if (!slack.ok) process.exit(1);
assert.equal(slack.value.idempotencyKey, "slack:T1:C1:1.2");
assert.equal(slack.value.payload.slackTs, "1.2");
const slackTsOnly = normalizeIntake({
  trigger: "slack_bot_mention",
  payload: { slackTs: "171.0", permalink: "https://example.slack.com/archives/C1/p171" },
});
assert.equal(slackTsOnly.ok, true);
if (!slackTsOnly.ok) process.exit(1);
assert.equal(slackTsOnly.value.idempotencyKey, "slack_ts:171.0");
const withEvent = normalizeIntake({
  trigger: "slack_bot_mention",
  payload: { teamId: "T", channelId: "C", slackTs: "1.2", eventId: "Ev123", permalink: "https://example.slack.com/p" },
});
assert.equal(withEvent.ok, true);
if (!withEvent.ok) process.exit(1);
assert.equal(withEvent.value.idempotencyKey, "slack_event:Ev123");
assert.equal(slackTsOnly.value.sourceRef, "https://example.slack.com/archives/C1/p171");
assert.equal(
  decideIntake(slack.value, { byKey: null, byPr: { id: "other", parentId: null } }).action,
  "create",
);

assert.equal(normalizeIntake({ name: "x" }).ok, false);
assert.equal(normalizeSourceRef("chat_delegate", " https://x "), "https://x");
console.log("intake checks ok");
