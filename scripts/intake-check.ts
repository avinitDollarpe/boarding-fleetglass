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
assert.equal(
  decideIntake(slack.value, { byKey: null, byPr: { id: "other", parentId: null } }).action,
  "create",
);

assert.equal(normalizeIntake({ name: "x" }).ok, false);
assert.equal(normalizeSourceRef("chat_delegate", " https://x "), "https://x");
console.log("intake checks ok");
