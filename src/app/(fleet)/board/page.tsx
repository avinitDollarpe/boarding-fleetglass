import { auth } from "@/auth";
import { linkCursor, recheckPlan } from "@/app/actions";
import { BoardStats } from "@/components/app/board-stats";
import { KanbanBoard, type BoardCard } from "@/components/app/kanban-board";
import { planOverride } from "@/lib/plan";
import { redirect } from "next/navigation";
import { heatAndStats, listTasks } from "@/server/fleet";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ checked?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const [tasks, stats, plan] = await Promise.all([
    listTasks(session.user.id),
    heatAndStats(session.user.id),
    readPlan(session.user.id),
  ]);
  const parents = tasks.filter((task) => !task.parentId);
  return (
    <div className="fleet-board -mx-6 -my-8 flex min-h-[calc(100vh-4rem)] flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="page-title text-white">Board</h1>
        <p className="mt-1 max-w-xl text-sm text-[oklch(0.72_0.012_80)]">
          Tasks arrive from Slack, GitHub, or a chat handoff. Drag a card to change its column.
        </p>
      </div>
      <details className="max-w-xl rounded-[8px] border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer">Cursor plan · {plan.status}</summary>
        <form action={linkCursor} className="mt-3 flex flex-col gap-2">
          <label htmlFor="apiKey">Cursor API key</label>
          <input id="apiKey" name="apiKey" type="password" autoComplete="off" className="field" placeholder="crsr_…" />
          <button type="submit" className="press btn btn-primary w-fit">
            Link and verify
          </button>
          {query.checked && plan.status !== "active" ? (
            <p className="text-danger">
              Plan is {plan.status}
              {plan.reason ? ` (${plan.reason})` : ""}. Launches stay blocked.
            </p>
          ) : null}
        </form>
        {planOverride() ? (
          <form action={recheckPlan} className="mt-3">
            <button type="submit" className="press btn btn-quiet">
              Apply local plan override
            </button>
          </form>
        ) : null}
      </details>
      <BoardStats
        open={parents.filter((task) => task.state !== "Done" && task.state !== "Cancelled").length}
        blocked={parents.filter((task) => task.state === "blocked:cursor_plan" || task.state === "Blocked").length}
        tokens={stats.weekTokens}
        costMicros={stats.weekCost}
      />
      {parents.length === 0 ? (
        <p className="max-w-xl text-sm text-muted-foreground">Nothing in this fleet yet.</p>
      ) : null}
      <KanbanBoard
        cards={parents.map((task): BoardCard => {
          const children = tasks.filter((child) => child.parentId === task.id);
          const payload = task.payload as Record<string, unknown>;
          const raw = payload.commentBody ?? payload.text ?? payload.context;
          const body = typeof raw === "string" ? raw.trim() : "";
          return {
            id: task.id,
            name: task.name,
            description: body && body !== task.name ? body : null,
            owner: task.owner,
            state: task.state,
            trigger: task.trigger,
            tokens: task.inputTokens + task.outputTokens,
            subtasks: children.length,
            subtasksDone: children.filter((child) => child.state === "Done").length,
            updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt),
          };
        })}
      />
    </div>
  );
}
