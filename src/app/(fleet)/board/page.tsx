import { auth } from "@/auth";
import { addTask, loadSample } from "@/app/actions";
import { BoardStats } from "@/components/app/board-stats";
import { KanbanBoard, type BoardCard } from "@/components/app/kanban-board";
import { redirect } from "next/navigation";
import { heatAndStats, listTasks } from "@/server/fleet";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [tasks, stats] = await Promise.all([listTasks(session.user.id), heatAndStats(session.user.id)]);
  const parents = tasks.filter((task) => !task.parentId);
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
      <BoardStats
        open={parents.filter((task) => task.state !== "Done" && task.state !== "Cancelled").length}
        blocked={parents.filter((task) => task.state === "blocked:cursor_plan").length}
        tokens={stats.weekTokens}
        costMicros={stats.weekCost}
      />
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
      <KanbanBoard
        cards={parents.map((task): BoardCard => {
          const children = tasks.filter((child) => child.parentId === task.id);
          return {
            id: task.id,
            name: task.name,
            owner: task.owner,
            state: task.state,
            trigger: task.trigger,
            tokens: task.inputTokens + task.outputTokens,
            subtasks: children.length,
            subtasksDone: children.filter((child) => child.state === "Done").length,
          };
        })}
      />
    </div>
  );
}
