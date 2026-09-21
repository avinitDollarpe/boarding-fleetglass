import { auth } from "@/auth";
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
      <div>
        <h1 className="page-title">Board</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Tasks arrive from Slack, GitHub, or a chat handoff. Drag a card to change its column.
        </p>
      </div>
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
