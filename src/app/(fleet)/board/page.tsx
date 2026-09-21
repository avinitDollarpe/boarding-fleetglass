import Link from "next/link";
import { auth } from "@/auth";
import { addTask, loadSample } from "@/app/actions";
import { StateBadge, TriggerLabel } from "@/components/app/state-badge";
import { formatTokens, formatUsdFromMicros } from "@/lib/format";
import { STATES } from "@/lib/states";
import { redirect } from "next/navigation";
import { heatAndStats, listTasks } from "@/server/fleet";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [tasks, stats] = await Promise.all([listTasks(session.user.id), heatAndStats(session.user.id)]);
  const parents = tasks.filter((task) => !task.parentId);
  const childCount = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentId) childCount.set(task.parentId, (childCount.get(task.parentId) ?? 0) + 1);
  }
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Board</h1>
          <p className="mt-1 text-sm text-muted-foreground">One fleet. Every trigger Gilfoyle is watching.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <form action={loadSample}>
            <button type="submit" className="press btn btn-quiet">
              Load sample fleet
            </button>
          </form>
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          ["Open", String(parents.filter((task) => task.state !== "Done" && task.state !== "Cancelled").length)],
          ["Plan blocked", String(parents.filter((task) => task.state === "blocked:cursor_plan").length)],
          ["Tokens, 7d", formatTokens(stats.weekTokens)],
          ["Estimate, 7d", formatUsdFromMicros(stats.weekCost)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="num mt-2 text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
      {parents.some((task) => task.isSample) ? (
        <p className="text-sm text-muted-foreground">Sample fleet is on this board. Token rows sourced as sample are generated locally so the heatmap has a shape.</p>
      ) : null}
      {parents.length === 0 ? (
        <div className="card flex flex-col gap-3 p-6">
          <h2 className="text-xl font-medium">Nothing in this fleet yet</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            A Slack mention, a GitHub mention, or a chat delegate lands here before any cloud agent starts. You can also add one by hand.
          </p>
        </div>
      ) : null}
      <form action={addTask} className="card grid gap-3 p-4 md:grid-cols-[1fr_180px_auto] md:items-end">
        <label className="flex flex-col gap-1 text-sm">
          Task
          <input name="name" required className="field" placeholder="What should Gilfoyle track?" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Owner
          <input name="owner" className="field" placeholder="Gilfoyle" />
        </label>
        <button type="submit" className="press btn btn-primary">
          Add task
        </button>
      </form>
      <div className="flex gap-4 overflow-x-auto pb-4 pe-8">
        {STATES.map((state) => {
          const column = parents.filter((task) => task.state === state);
          return (
            <section key={state} className="card w-72 shrink-0 p-3">
              <header className="mb-3 flex items-center justify-between gap-2">
                <StateBadge state={state} />
                <span className="num text-sm text-muted-foreground">{column.length}</span>
              </header>
              <ul className="flex flex-col gap-2">
                {column.length === 0 ? <li className="px-1 py-2 text-sm text-muted-foreground">None</li> : null}
                {column.map((task) => (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="block rounded-[12px] border border-border bg-background p-3">
                      <div className="font-medium">{task.name}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <TriggerLabel trigger={task.trigger} />
                        <span className="num text-xs text-muted-foreground">{formatTokens(task.inputTokens + task.outputTokens)}</span>
                      </div>
                      {childCount.get(task.id) ? (
                        <div className="mt-2 text-xs text-muted-foreground">{childCount.get(task.id)} subtasks</div>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
