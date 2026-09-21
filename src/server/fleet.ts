import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withUser, type AppDb } from "@/db/client";
import { dailyRollups, taskEvents, tasks, tokenUsage } from "@/db/schema";
import { estimateCostMicros } from "@/lib/cost";
import { utcDay } from "@/lib/format";
import { decideIntake, normalizeIntake, type IntakeInput, type TriggerPayload } from "@/lib/intake";
import { PLAN_BLOCKED, isTaskState, type TaskState } from "@/lib/states";
import { fetchAgentUsage, launchCursorAgent } from "@/server/cursor";
import { cursorKeyForUser } from "@/server/keys";
import { verifyPlan } from "@/server/plan";
import { addDays, mondayOf, startOfDay } from "@/components/charts/heat-calendar/utils";

type Actor = "dashboard" | "gilfoyle" | "chief" | "system" | "cursor";

export class FleetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function addRollup(
  tx: AppDb,
  row: {
    userId: string;
    taskId: string | null;
    day: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costMicros: number;
    eventCount: number;
    tasksDone: number;
  },
) {
  if (row.taskId) {
    await tx.execute(sql`
      INSERT INTO daily_rollups (
        user_id, day, task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_micros, event_count, tasks_done
      ) VALUES (
        ${row.userId}, ${row.day}, ${row.taskId}, ${row.inputTokens}, ${row.outputTokens},
        ${row.cacheReadTokens}, ${row.cacheWriteTokens}, ${row.costMicros}, ${row.eventCount}, ${row.tasksDone}
      )
      ON CONFLICT (user_id, day, task_id) WHERE task_id IS NOT NULL
      DO UPDATE SET
        input_tokens = daily_rollups.input_tokens + EXCLUDED.input_tokens,
        output_tokens = daily_rollups.output_tokens + EXCLUDED.output_tokens,
        cache_read_tokens = daily_rollups.cache_read_tokens + EXCLUDED.cache_read_tokens,
        cache_write_tokens = daily_rollups.cache_write_tokens + EXCLUDED.cache_write_tokens,
        cost_micros = daily_rollups.cost_micros + EXCLUDED.cost_micros,
        event_count = daily_rollups.event_count + EXCLUDED.event_count,
        tasks_done = daily_rollups.tasks_done + EXCLUDED.tasks_done,
        updated_at = now()
    `);
  }
  await tx.execute(sql`
    INSERT INTO daily_rollups (
      user_id, day, task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cost_micros, event_count, tasks_done
    ) VALUES (
      ${row.userId}, ${row.day}, NULL, ${row.inputTokens}, ${row.outputTokens},
      ${row.cacheReadTokens}, ${row.cacheWriteTokens}, ${row.costMicros}, ${row.eventCount}, ${row.tasksDone}
    )
    ON CONFLICT (user_id, day) WHERE task_id IS NULL
    DO UPDATE SET
      input_tokens = daily_rollups.input_tokens + EXCLUDED.input_tokens,
      output_tokens = daily_rollups.output_tokens + EXCLUDED.output_tokens,
      cache_read_tokens = daily_rollups.cache_read_tokens + EXCLUDED.cache_read_tokens,
      cache_write_tokens = daily_rollups.cache_write_tokens + EXCLUDED.cache_write_tokens,
      cost_micros = daily_rollups.cost_micros + EXCLUDED.cost_micros,
      event_count = daily_rollups.event_count + EXCLUDED.event_count,
      tasks_done = daily_rollups.tasks_done + EXCLUDED.tasks_done,
      updated_at = now()
  `);
}

async function recordEvent(
  tx: AppDb,
  input: {
    userId: string;
    taskId: string;
    kind: string;
    fromState?: string | null;
    toState?: string | null;
    note?: string | null;
    actor: Actor;
    payload?: Record<string, unknown>;
  },
) {
  await tx.insert(taskEvents).values({
    userId: input.userId,
    taskId: input.taskId,
    kind: input.kind,
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    note: input.note ?? null,
    actor: input.actor,
    payload: input.payload ?? {},
  });
}

function publicTask(row: typeof tasks.$inferSelect) {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    owner: row.owner,
    state: row.state,
    trigger: row.trigger,
    source: row.source,
    sourceRef: row.sourceRef,
    payload: row.triggerPayload,
    idempotencyKey: row.idempotencyKey,
    prs: row.prs,
    prUrl: row.prUrl,
    cloudAgentUrl: row.cloudAgentUrl,
    bcId: row.bcId,
    cursorRunId: row.cursorRunId,
    repoUrl: row.repoUrl,
    lastCommit: row.lastCommit,
    isSample: row.isSample,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function initialState(userId: string): Promise<TaskState> {
  const plan = await verifyPlan(userId);
  return plan.status === "active" ? "Holding" : PLAN_BLOCKED;
}

export async function createTask(userId: string, input: IntakeInput & {
  externalId?: string | null;
  prs?: string | null;
  repoUrl?: string | null;
  subtasks?: IntakeInput[];
  parentId?: string | null;
  actor?: Actor;
}, actor: Actor = "gilfoyle") {
  const normalized = normalizeIntake(input);
  if (!normalized.ok) throw new FleetError(normalized.error, 400, "invalid_trigger");
  const intake = normalized.value;
  const state = await initialState(userId);

  return withUser(userId, async (tx) => {
    const byKey = intake.idempotencyKey
      ? (
          await tx
            .select({ id: tasks.id, parentId: tasks.parentId })
            .from(tasks)
            .where(and(eq(tasks.userId, userId), eq(tasks.idempotencyKey, intake.idempotencyKey)))
        )[0] ?? null
      : null;
    const byPr =
      intake.trigger === "github_pr_mention" && intake.sourceRef
        ? (
            await tx
              .select({ id: tasks.id, parentId: tasks.parentId })
              .from(tasks)
              .where(
                and(
                  eq(tasks.userId, userId),
                  eq(tasks.sourceRef, intake.sourceRef),
                  eq(tasks.trigger, "github_pr_mention"),
                  isNull(tasks.parentId),
                ),
              )
          )[0] ?? null
        : null;

    const decision = decideIntake(intake, { byKey, byPr });
    if (decision.action === "dedupe") {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, decision.taskId));
      return { task: publicTask(existing), deduped: true, linkedToParent: Boolean(existing.parentId), parentId: existing.parentId };
    }

    let parentId = decision.action === "follow_up" ? decision.parentId : input.parentId ?? null;
    if (decision.action === "create" && parentId) {
      const [parent] = await tx
        .select({ id: tasks.id, parentId: tasks.parentId })
        .from(tasks)
        .where(and(eq(tasks.id, parentId), eq(tasks.userId, userId)));
      if (!parent) throw new FleetError("Parent task not found", 404, "not_found");
      if (parent.parentId) throw new FleetError("Subtasks are one level deep", 400, "nested_subtask");
    }
    const [created] = await tx
      .insert(tasks)
      .values({
        userId,
        parentId,
        externalId: input.externalId?.trim() || null,
        idempotencyKey: intake.idempotencyKey,
        name: intake.name,
        owner: intake.owner,
        state,
        trigger: intake.trigger,
        source: intake.source,
        sourceRef: intake.sourceRef,
        triggerPayload: intake.payload as Record<string, unknown>,
        prs: input.prs ?? null,
        prUrl: intake.trigger === "github_pr_mention" ? intake.sourceRef : null,
        repoUrl: input.repoUrl ?? (typeof intake.payload.repo === "string" ? `https://github.com/${intake.payload.repo}` : null),
      })
      .returning();

    await recordEvent(tx, {
      userId,
      taskId: created.id,
      kind: parentId ? "follow_up_linked" : "created",
      toState: state,
      actor: input.actor ?? actor,
      note: parentId ? "Linked to the existing pull request task" : null,
      payload: { trigger: intake.trigger, sourceRef: intake.sourceRef, idempotencyKey: intake.idempotencyKey },
    });
    if (parentId) {
      await recordEvent(tx, {
        userId,
        taskId: parentId,
        kind: "follow_up_linked",
        actor: input.actor ?? actor,
        note: created.name,
        payload: { childId: created.id, idempotencyKey: intake.idempotencyKey },
      });
    }

    if (!parentId && input.subtasks?.length) {
      for (const child of input.subtasks) {
        const childIntake = normalizeIntake({ ...child, trigger: child.trigger || intake.trigger, source: child.source || intake.source });
        if (!childIntake.ok) throw new FleetError(childIntake.error, 400, "invalid_trigger");
        const [sub] = await tx
          .insert(tasks)
          .values({
            userId,
            parentId: created.id,
            name: childIntake.value.name,
            owner: childIntake.value.owner || intake.owner,
            state,
            trigger: childIntake.value.trigger,
            source: childIntake.value.source,
            sourceRef: childIntake.value.sourceRef,
            idempotencyKey: childIntake.value.idempotencyKey,
            triggerPayload: childIntake.value.payload as Record<string, unknown>,
          })
          .returning();
        await recordEvent(tx, {
          userId,
          taskId: sub.id,
          kind: "created",
          toState: state,
          actor: input.actor ?? actor,
          payload: { parentId: created.id },
        });
      }
    }

    return {
      task: publicTask(created),
      deduped: false,
      linkedToParent: Boolean(parentId),
      parentId,
    };
  });
}

export async function listTasks(userId: string) {
  const rows = await withUser(userId, (tx) =>
    tx.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.updatedAt)),
  );
  const totals = await withUser(userId, (tx) =>
    tx
      .select({
        taskId: tokenUsage.taskId,
        inputTokens: sql<number>`coalesce(sum(${tokenUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${tokenUsage.outputTokens}), 0)::int`,
        costMicros: sql<number>`coalesce(sum(${tokenUsage.costMicros}), 0)::bigint`,
      })
      .from(tokenUsage)
      .where(eq(tokenUsage.userId, userId))
      .groupBy(tokenUsage.taskId),
  );
  const byTask = new Map(totals.map((row) => [row.taskId, row]));
  return rows.map((row) => {
    const usage = byTask.get(row.id);
    return {
      ...publicTask(row),
      inputTokens: Number(usage?.inputTokens ?? 0),
      outputTokens: Number(usage?.outputTokens ?? 0),
      costMicros: Number(usage?.costMicros ?? 0),
    };
  });
}

export async function getTask(userId: string, id: string) {
  return withUser(userId, async (tx) => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!task) return null;
    const subtasks = await tx.select().from(tasks).where(eq(tasks.parentId, id)).orderBy(tasks.createdAt);
    const events = await tx
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, id))
      .orderBy(desc(taskEvents.occurredAt));
    const usage = await tx
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.taskId, id))
      .orderBy(desc(tokenUsage.occurredAt));
    const childIds = subtasks.map((row) => row.id);
    return { task: publicTask(task), subtasks: subtasks.map(publicTask), events, usage, childIds };
  });
}

export async function updateTask(
  userId: string,
  id: string,
  patch: {
    name?: string;
    owner?: string;
    prs?: string | null;
    prUrl?: string | null;
    lastCommit?: string | null;
    repoUrl?: string | null;
    bcId?: string | null;
    cloudAgentUrl?: string | null;
  },
  actor: Actor = "gilfoyle",
) {
  const saved = await withUser(userId, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!current) throw new FleetError("Task not found", 404, "not_found");
    const nextBc = patch.bcId?.trim();
    let blocked = false;
    if (nextBc && nextBc !== current.bcId) {
      const plan = await verifyPlan(userId);
      if (plan.status !== "active") {
        blocked = true;
        await tx.update(tasks).set({ state: PLAN_BLOCKED, updatedAt: new Date() }).where(eq(tasks.id, id));
        await recordEvent(tx, {
          userId,
          taskId: id,
          kind: "plan_blocked",
          fromState: current.state,
          toState: PLAN_BLOCKED,
          actor,
          note: "Refused to attach a cloud agent without an active Cursor plan",
        });
      }
    }
    if (blocked) return { blocked: true as const };
    const [updated] = await tx
      .update(tasks)
      .set({
        name: patch.name?.trim() || current.name,
        owner: patch.owner !== undefined ? patch.owner : current.owner,
        prs: patch.prs !== undefined ? patch.prs : current.prs,
        prUrl: patch.prUrl !== undefined ? patch.prUrl : current.prUrl,
        lastCommit: patch.lastCommit !== undefined ? patch.lastCommit : current.lastCommit,
        repoUrl: patch.repoUrl !== undefined ? patch.repoUrl : current.repoUrl,
        bcId: patch.bcId !== undefined ? patch.bcId : current.bcId,
        cloudAgentUrl: patch.cloudAgentUrl !== undefined ? patch.cloudAgentUrl : current.cloudAgentUrl,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    await recordEvent(tx, { userId, taskId: id, kind: "updated", actor, payload: patch as Record<string, unknown> });
    return { blocked: false as const, task: publicTask(updated) };
  });
  if (saved.blocked) {
    throw new FleetError("Cursor plan is not active", 409, "cursor_plan_inactive", { state: PLAN_BLOCKED });
  }
  return saved.task;
}

export async function transitionTask(userId: string, id: string, state: string, note: string | null, actor: Actor) {
  if (!isTaskState(state)) throw new FleetError("Unknown state", 400, "invalid_state");
  const saved = await withUser(userId, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!current) throw new FleetError("Task not found", 404, "not_found");
    let next: TaskState = state;
    if (!current.bcId && state !== current.state && state !== "Holding" && state !== "Blocked" && state !== "Done" && state !== "Cancelled" && state !== PLAN_BLOCKED) {
      const plan = await verifyPlan(userId);
      if (plan.status !== "active") next = PLAN_BLOCKED;
    }
    const [updated] = await tx
      .update(tasks)
      .set({ state: next, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    await recordEvent(tx, {
      userId,
      taskId: id,
      kind: next === PLAN_BLOCKED && state !== PLAN_BLOCKED ? "plan_blocked" : "state_changed",
      fromState: current.state,
      toState: next,
      note,
      actor,
    });
    if (next === "Done" && current.state !== "Done") {
      await addRollup(tx, {
        userId,
        taskId: id,
        day: utcDay(),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicros: 0,
        eventCount: 0,
        tasksDone: 1,
      });
    }
    return { task: publicTask(updated), blocked: next === PLAN_BLOCKED && state !== PLAN_BLOCKED };
  });
  if (saved.blocked) {
    throw new FleetError("Cursor plan is not active", 409, "cursor_plan_inactive", { state: PLAN_BLOCKED, task: saved.task });
  }
  return saved.task;
}

export async function launchTask(
  userId: string,
  id: string,
  input: { prompt: string; repoUrl?: string | null; startingRef?: string | null },
  actor: Actor,
) {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new FleetError("prompt is required", 400, "invalid_prompt");
  const plan = await verifyPlan(userId);
  if (plan.status !== "active") {
    await withUser(userId, async (tx) => {
      const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
      if (!current) throw new FleetError("Task not found", 404, "not_found");
      await tx.update(tasks).set({ state: PLAN_BLOCKED, updatedAt: new Date() }).where(eq(tasks.id, id));
      await recordEvent(tx, {
        userId,
        taskId: id,
        kind: "plan_blocked",
        fromState: current.state,
        toState: PLAN_BLOCKED,
        actor,
        note: "Launch refused. Cursor plan is not active.",
      });
    });
    throw new FleetError("Cursor plan is not active", 409, "cursor_plan_inactive", { state: PLAN_BLOCKED });
  }

  const apiKey = await cursorKeyForUser(userId);
  if (!apiKey) throw new FleetError("Link a Cursor API key before launch", 400, "cursor_unlinked");

  const task = await withUser(userId, async (tx) => {
    const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!current) throw new FleetError("Task not found", 404, "not_found");
    return current;
  });

  const launched = await launchCursorAgent(apiKey, {
    name: task.name,
    prompt,
    repoUrl: input.repoUrl || task.repoUrl,
    startingRef: input.startingRef,
  });
  if (!launched.ok) {
    if (launched.planBlocked) {
      await withUser(userId, async (tx) => {
        await tx.update(tasks).set({ state: PLAN_BLOCKED, updatedAt: new Date() }).where(eq(tasks.id, id));
        await recordEvent(tx, {
          userId,
          taskId: id,
          kind: "plan_blocked",
          fromState: task.state,
          toState: PLAN_BLOCKED,
          actor,
          note: "Cursor refused the launch for plan or billing",
        });
      });
      throw new FleetError("Cursor refused the launch", 409, "cursor_plan_inactive", { state: PLAN_BLOCKED });
    }
    throw new FleetError("Cursor launch failed", 502, "cursor_launch_failed", { detail: launched.body.slice(0, 400) });
  }

  return withUser(userId, async (tx) => {
    const [updated] = await tx
      .update(tasks)
      .set({
        state: "Working",
        bcId: launched.agent.id,
        cloudAgentUrl: launched.agent.url ?? `https://cursor.com/agents/${launched.agent.id}`,
        cursorRunId: launched.agent.latestRunId ?? null,
        repoUrl: input.repoUrl || task.repoUrl,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    await recordEvent(tx, {
      userId,
      taskId: id,
      kind: "launched",
      fromState: task.state,
      toState: "Working",
      actor,
      payload: { bcId: launched.agent.id, url: updated.cloudAgentUrl },
    });
    return publicTask(updated);
  });
}

export async function ingestUsage(
  userId: string,
  input: {
    taskId: string;
    agentId?: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    occurredAt?: string | null;
    externalRef?: string | null;
    source?: string;
  },
  actor: Actor,
) {
  const model = input.model?.trim();
  if (!model) throw new FleetError("model is required", 400, "invalid_usage");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new FleetError("occurredAt is invalid", 400, "invalid_usage");
  const tokens = {
    inputTokens: Math.max(0, Math.round(input.inputTokens || 0)),
    outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
    cacheReadTokens: Math.max(0, Math.round(input.cacheReadTokens || 0)),
    cacheWriteTokens: Math.max(0, Math.round(input.cacheWriteTokens || 0)),
  };
  const costMicros = estimateCostMicros({ model, ...tokens });

  return withUser(userId, async (tx) => {
    const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.userId, userId)));
    if (!task) throw new FleetError("Task not found", 404, "not_found");

    let delta = { ...tokens, costMicros, eventCount: 1 };
    if (input.externalRef) {
      const [existing] = await tx
        .select()
        .from(tokenUsage)
        .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.externalRef, input.externalRef)));
      if (existing) {
        delta = {
          inputTokens: tokens.inputTokens - existing.inputTokens,
          outputTokens: tokens.outputTokens - existing.outputTokens,
          cacheReadTokens: tokens.cacheReadTokens - existing.cacheReadTokens,
          cacheWriteTokens: tokens.cacheWriteTokens - existing.cacheWriteTokens,
          costMicros: costMicros - existing.costMicros,
          eventCount: 0,
        };
        await tx
          .update(tokenUsage)
          .set({ ...tokens, costMicros, model, agentId: input.agentId ?? existing.agentId })
          .where(eq(tokenUsage.id, existing.id));
      } else {
        await tx.insert(tokenUsage).values({
          userId,
          taskId: input.taskId,
          agentId: input.agentId ?? null,
          model,
          ...tokens,
          costMicros,
          source: input.source ?? "ingest",
          externalRef: input.externalRef,
          occurredAt,
        });
      }
    } else {
      await tx.insert(tokenUsage).values({
        userId,
        taskId: input.taskId,
        agentId: input.agentId ?? null,
        model,
        ...tokens,
        costMicros,
        source: input.source ?? "ingest",
        occurredAt,
      });
    }

    if (delta.inputTokens || delta.outputTokens || delta.cacheReadTokens || delta.cacheWriteTokens || delta.costMicros || delta.eventCount) {
      await addRollup(tx, {
        userId,
        taskId: input.taskId,
        day: utcDay(occurredAt),
        ...delta,
        tasksDone: 0,
      });
    }
    await recordEvent(tx, {
      userId,
      taskId: input.taskId,
      kind: "usage_recorded",
      actor,
      payload: { model, ...tokens, agentId: input.agentId ?? null },
    });
    return { ok: true, costMicros };
  });
}

export async function syncTaskUsage(userId: string, id: string) {
  const apiKey = await cursorKeyForUser(userId);
  const task = await withUser(userId, async (tx) => {
    const [row] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return row ?? null;
  });
  if (!task) throw new FleetError("Task not found", 404, "not_found");
  if (!task.bcId || !apiKey) return { synced: 0 };
  const usage = await fetchAgentUsage(apiKey, task.bcId);
  if (!usage.ok) return { synced: 0 };
  let synced = 0;
  for (const run of usage.runs) {
    await ingestUsage(
      userId,
      {
        taskId: id,
        agentId: task.bcId,
        model: "cursor-cloud",
        inputTokens: run.usage?.inputTokens ?? 0,
        outputTokens: run.usage?.outputTokens ?? 0,
        cacheReadTokens: run.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: run.usage?.cacheWriteTokens ?? 0,
        externalRef: `cursor:${task.bcId}:${run.id}`,
        source: "cursor_usage",
      },
      "cursor",
    );
    synced += 1;
  }
  return { synced };
}

export async function agentStatus(
  userId: string,
  input: {
    taskId?: string;
    idempotencyKey?: string;
    state?: string;
    bcId?: string | null;
    prUrl?: string | null;
    cloudAgentUrl?: string | null;
    lastCommit?: string | null;
    note?: string | null;
  },
  actor: Actor,
) {
  const id = input.taskId
    ? input.taskId
    : input.idempotencyKey
      ? (
          await withUser(userId, (tx) =>
            tx
              .select({ id: tasks.id })
              .from(tasks)
              .where(and(eq(tasks.userId, userId), eq(tasks.idempotencyKey, input.idempotencyKey!))),
          )
        )[0]?.id
      : null;
  if (!id) throw new FleetError("taskId or idempotencyKey is required", 400, "invalid_status");
  if (input.bcId || input.prUrl || input.cloudAgentUrl || input.lastCommit) {
    await updateTask(
      userId,
      id,
      {
        bcId: input.bcId ?? undefined,
        prUrl: input.prUrl ?? undefined,
        cloudAgentUrl: input.cloudAgentUrl ?? undefined,
        lastCommit: input.lastCommit ?? undefined,
      },
      actor,
    );
  }
  if (input.state) return transitionTask(userId, id, input.state, input.note ?? null, actor);
  const loaded = await getTask(userId, id);
  if (!loaded) throw new FleetError("Task not found", 404, "not_found");
  return loaded.task;
}

export async function taskStatus(userId: string, id: string) {
  const loaded = await getTask(userId, id);
  if (!loaded) throw new FleetError("Task not found", 404, "not_found");
  const tokens = loaded.usage.reduce(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      costMicros: sum.costMicros + row.costMicros,
    }),
    { inputTokens: 0, outputTokens: 0, costMicros: 0 },
  );
  return {
    task: loaded.task,
    subtasks: loaded.subtasks.map((row) => ({ id: row.id, name: row.name, state: row.state, bcId: row.bcId })),
    latestEvent: loaded.events[0] ?? null,
    tokens,
  };
}

export async function heatAndStats(userId: string) {
  const end = startOfDay(new Date());
  const weeks = 20;
  const start = addDays(mondayOf(end), -(weeks - 1) * 7);
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        day: dailyRollups.day,
        eventCount: dailyRollups.eventCount,
        costMicros: dailyRollups.costMicros,
        tasksDone: dailyRollups.tasksDone,
        inputTokens: dailyRollups.inputTokens,
        outputTokens: dailyRollups.outputTokens,
      })
      .from(dailyRollups)
      .where(and(eq(dailyRollups.userId, userId), isNull(dailyRollups.taskId))),
  );
  const byDay = new Map(rows.map((row) => [row.day, row]));
  let max = 1;
  const values: number[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: number[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      if (date > end) {
        column.push(0);
        continue;
      }
      const key = date.toISOString().slice(0, 10);
      const count = Number(byDay.get(key)?.eventCount ?? 0);
      if (count > max) max = count;
      column.push(count);
    }
    values.push(column);
  }
  const scaled = values.map((column) => column.map((count) => count / max));
  const recent = rows.filter((row) => row.day >= addDays(end, -6).toISOString().slice(0, 10));
  return {
    values: scaled,
    maxCount: max,
    endDate: end.toISOString(),
    weekCost: recent.reduce((sum, row) => sum + Number(row.costMicros), 0),
    weekTokens: recent.reduce((sum, row) => sum + Number(row.inputTokens) + Number(row.outputTokens), 0),
    weekDone: recent.reduce((sum, row) => sum + Number(row.tasksDone), 0),
    days: rows
      .map((row) => ({
        day: row.day,
        costMicros: Number(row.costMicros),
        eventCount: Number(row.eventCount),
        tasksDone: Number(row.tasksDone),
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-28),
  };
}

export async function deleteTask(userId: string, id: string) {
  await withUser(userId, async (tx) => {
    const [current] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!current) throw new FleetError("Task not found", 404, "not_found");
    await tx.delete(tasks).where(eq(tasks.id, id));
  });
}

export type { TriggerPayload };
