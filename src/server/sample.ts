import { eq, inArray } from "drizzle-orm";
import { withUser } from "@/db/client";
import { tasks } from "@/db/schema";
import { ingestUsage, createTask } from "@/server/fleet";

export async function loadSampleFleet(userId: string) {
  const existing = await withUser(userId, (tx) =>
    tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.isSample, true)).limit(1),
  );
  if (existing.length) return { loaded: false };

  const ids: string[] = [];
  const parent = await createTask(userId, {
    name: "Harden checkout retries",
    trigger: "github_pr_mention",
    sourceRef: "https://github.com/example/checkout/pull/148",
    idempotencyKey: "sample:pr-148:comment-1",
    owner: "Gilfoyle",
    commentId: "sample-comment-1",
    payload: {
      repo: "example/checkout",
      prNumber: 148,
      prUrl: "https://github.com/example/checkout/pull/148",
      commentBody: "@cursor the retry budget still drops the second charge",
      commenter: "chakravarti",
      mentionTargets: ["cursor"],
      commentId: "sample-comment-1",
    },
    actor: "chief",
  });

  ids.push(parent.task.id);
  const follow = await createTask(userId, {
    name: "Follow-up: cover the partial capture path",
    trigger: "github_pr_mention",
    sourceRef: "https://github.com/example/checkout/pull/148",
    idempotencyKey: "sample:pr-148:comment-2",
    owner: "Gilfoyle",
    payload: {
      repo: "example/checkout",
      prNumber: 148,
      commentBody: "@cursor also cover partial capture",
      commenter: "chakravarti",
      mentionTargets: ["cursor", "chakravarti"],
      commentId: "sample-comment-2",
    },
    actor: "chief",
  });

  ids.push(follow.task.id);
  const slack = await createTask(userId, {
    name: "Alias mention in #eng-supervisor",
    trigger: "slack_bot_mention",
    sourceRef: "https://example.slack.com/archives/C01/p1710000000000000",
    idempotencyKey: "sample:slack:eng:1",
    owner: "Chief",
    payload: {
      teamId: "T_SAMPLE",
      channelId: "C01",
      channel: "eng-supervisor",
      permalink: "https://example.slack.com/archives/C01/p1710000000000000",
      text: "@gilfoyle watch the checkout agent through Watching 2/3",
      user: "chakravarti",
      messageTs: "1710000000.000000",
    },
    actor: "chief",
  });

  ids.push(slack.task.id);
  const chat = await createTask(userId, {
    name: "Delegate the fleetglass verify notes",
    trigger: "chat_delegate",
    idempotencyKey: "sample:chat:1",
    owner: "Chakravarti",
    payload: { context: "User asked Grok Bot to hand the verify notes to Gilfoyle", via: "chat" },
    actor: "chief",
  });

  ids.push(chat.task.id);
  await withUser(userId, async (tx) => {
    await tx.update(tasks).set({ isSample: true }).where(inArray(tasks.id, ids));
    await tx.update(tasks).set({ state: "Working", bcId: "bc-sample", cloudAgentUrl: "https://cursor.com/agents/bc-sample" }).where(eq(tasks.id, parent.task.id));
    await tx.update(tasks).set({ state: "Watching 1/3" }).where(eq(tasks.id, follow.task.id));
    await tx.update(tasks).set({ state: "Ready for review", prUrl: "https://github.com/example/checkout/pull/149" }).where(eq(tasks.id, slack.task.id));
    await tx.update(tasks).set({ state: "blocked:cursor_plan" }).where(eq(tasks.id, chat.task.id));
  });

  const anchor = parent.task;
  const now = Date.now();
  for (let day = 0; day < 70; day += 1) {
    const swing = 400 + ((day * 97) % 1800);
    await ingestUsage(
      userId,
      {
        taskId: anchor.id,
        agentId: "bc-sample",
        model: "composer-2",
        inputTokens: swing,
        outputTokens: Math.round(swing / 4),
        occurredAt: new Date(now - day * 86_400_000).toISOString(),
        source: "sample",
      },
      "system",
    );
  }
  return { loaded: true };
}
