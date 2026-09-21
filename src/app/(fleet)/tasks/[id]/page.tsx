import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { changeState, launchAgent, recordUsage } from "@/app/actions";
import { StateBadge, TriggerLabel } from "@/components/app/state-badge";
import { TaskPanels } from "@/components/app/task-panels";
import { formatTokens, formatUsdFromMicros } from "@/lib/format";
import { STATES } from "@/lib/states";
import { getTask } from "@/server/fleet";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const loaded = await getTask(session.user.id, id);
  if (!loaded) notFound();
  const { task, subtasks, events, usage } = loaded;
  const input = usage.reduce((sum, row) => sum + row.inputTokens, 0);
  const output = usage.reduce((sum, row) => sum + row.outputTokens, 0);
  const cost = usage.reduce((sum, row) => sum + row.costMicros, 0);
  const payload = task.payload as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {task.parentId ? (
          <Link href={`/tasks/${task.parentId}`} className="text-sm text-muted-foreground">
            Parent task
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{task.name}</h1>
          <StateBadge state={task.state} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <TriggerLabel trigger={task.trigger} />
          {task.owner ? <span>{task.owner}</span> : null}
          {task.sourceRef ? (
            <a href={task.sourceRef} className="text-primary">
              {task.sourceRef}
            </a>
          ) : null}
          {task.bcId ? (
            <a href={task.cloudAgentUrl ?? `https://cursor.com/agents/${task.bcId}`} className="text-primary">
              {task.bcId}
            </a>
          ) : null}
          {task.prUrl ? (
            <a href={task.prUrl} className="text-primary">
              Pull request
            </a>
          ) : null}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <dt className="text-sm text-muted-foreground">Input</dt>
          <dd className="num mt-2 text-2xl">{formatTokens(input)}</dd>
        </div>
        <div className="card p-4">
          <dt className="text-sm text-muted-foreground">Output</dt>
          <dd className="num mt-2 text-2xl">{formatTokens(output)}</dd>
        </div>
        <div className="card p-4">
          <dt className="text-sm text-muted-foreground">Estimate</dt>
          <dd className="num mt-2 text-2xl">{formatUsdFromMicros(cost)}</dd>
        </div>
      </dl>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <form action={changeState} className="card flex flex-col gap-3 p-4">
          <input type="hidden" name="taskId" value={task.id} />
          <label htmlFor="state" className="text-sm">
            State
          </label>
          <select id="state" name="state" defaultValue={task.state} className="field">
            {STATES.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
          <button type="submit" className="press btn btn-quiet">
            Update state
          </button>
          {task.idempotencyKey ? <p className="text-xs text-muted-foreground">Idempotency {task.idempotencyKey}</p> : null}
          {typeof payload.commenter === "string" ? <p className="text-xs text-muted-foreground">Commenter {payload.commenter}</p> : null}
          {typeof payload.user === "string" ? <p className="text-xs text-muted-foreground">Slack user {payload.user}</p> : null}
        </form>
        <div className="card p-4">
          <TaskPanels events={events} subtasks={subtasks} usage={usage} />
        </div>
      </div>
      {!task.bcId && task.state !== "Done" && task.state !== "Cancelled" ? (
        <form action={launchAgent} className="card grid gap-3 p-4">
          <h2 className="text-lg font-medium">Launch cloud agent</h2>
          <p className="text-sm text-muted-foreground">This checks the Cursor plan again. An inactive plan sets blocked:cursor_plan and does not call Cursor.</p>
          {query.error ? <p className="text-sm text-[oklch(0.78_0.14_25)]">{query.error}</p> : null}
          <input type="hidden" name="taskId" value={task.id} />
          <label className="flex flex-col gap-1 text-sm">
            Prompt
            <textarea name="prompt" required className="field min-h-28 py-2" placeholder="What should the agent do?" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Repository
              <input name="repoUrl" defaultValue={task.repoUrl ?? ""} className="field" placeholder="https://github.com/org/repo" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Starting ref
              <input name="startingRef" defaultValue="main" className="field" />
            </label>
          </div>
          <button type="submit" className="press btn btn-primary w-fit">
            Launch
          </button>
        </form>
      ) : null}
      <form action={recordUsage} className="card grid gap-3 p-4 md:grid-cols-4 md:items-end">
        <input type="hidden" name="taskId" value={task.id} />
        <label className="flex flex-col gap-1 text-sm">
          Model
          <input name="model" defaultValue="composer-2" className="field" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Input tokens
          <input name="inputTokens" type="number" min="0" defaultValue="0" className="field" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Output tokens
          <input name="outputTokens" type="number" min="0" defaultValue="0" className="field" />
        </label>
        <button type="submit" className="press btn btn-quiet">
          Record usage
        </button>
      </form>
    </div>
  );
}
