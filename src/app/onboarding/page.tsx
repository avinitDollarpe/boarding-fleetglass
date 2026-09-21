import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { linkCursor, recheckPlan } from "@/app/actions";
import { Shell } from "@/components/app/shell";
import { StateBadge } from "@/components/app/state-badge";
import { listTasks } from "@/server/fleet";
import { planOverride } from "@/lib/plan";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ checked?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const plan = await readPlan(session.user.id);
  if (plan.status === "active") redirect("/board");
  const query = await searchParams;
  const tasks = await listTasks(session.user.id);
  const blocked = tasks.filter((task) => task.state === "blocked:cursor_plan" && !task.parentId);
  return (
    <Shell email={session.user.email} planActive={false}>
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="page-title">Cursor plan required</h1>
          <p className="text-muted-foreground">
            Fleetglass launches cloud agents only while the linked Cursor plan is active. Link the API key from Cursor Dashboard → API Keys. We store it encrypted and fail closed if the plan cannot be confirmed.
          </p>
        </div>
        <form action={linkCursor} className="card flex flex-col gap-3 p-4">
          <label htmlFor="apiKey" className="text-sm">
            Cursor API key
          </label>
          <input id="apiKey" name="apiKey" type="password" required autoComplete="off" className="field" placeholder="crsr_…" />
          <button type="submit" className="press btn btn-primary">
            Link and verify plan
          </button>
          {query.checked ? (
            <p className="text-sm text-danger">
              Plan status: {plan.status}
              {plan.reason ? ` (${plan.reason})` : ""}. Tasks that would have launched are marked blocked:cursor_plan.
            </p>
          ) : null}
        </form>
        {planOverride() ? (
          <form action={recheckPlan}>
            <button type="submit" className="press btn btn-quiet">
              Apply local plan override
            </button>
            <p className="mt-2 text-xs text-muted-foreground">DEV_PLAN_OVERRIDE is local-only and ignored on Vercel.</p>
          </form>
        ) : null}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Waiting on a plan</h2>
          {blocked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet. When a trigger arrives without an active plan, it lands here as blocked:cursor_plan and nothing spins up.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocked.map((task) => (
                <li key={task.id} className="card flex items-center justify-between gap-3 p-4">
                  <span>{task.name}</span>
                  <StateBadge state={task.state} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
