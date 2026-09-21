import { auth } from "@/auth";
import { HeatPanel } from "@/components/app/heat-panel";
import { NumberTicker } from "@/components/motion/number-ticker";
import { formatUsdFromMicros } from "@/lib/format";
import { redirect } from "next/navigation";
import { heatAndStats } from "@/server/fleet";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const stats = await heatAndStats(session.user.id);
  const maxCost = Math.max(1, ...stats.days.map((day) => day.costMicros));
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Token events over the last 20 weeks, plus cost and tasks marked done.</p>
      </div>
      <section className="card p-4">
        <h2 className="mb-4 text-sm text-muted-foreground">Events</h2>
        <HeatPanel values={stats.values} maxCount={stats.maxCount} endDate={stats.endDate} />
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm text-muted-foreground">Estimated cost, 28 days</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {stats.days.length === 0 ? <li className="text-sm text-muted-foreground">No rollup yet.</li> : null}
            {stats.days.map((day) => (
              <li key={day.day} className="grid grid-cols-[88px_1fr_72px] items-center gap-3 text-sm">
                <span className="num text-muted-foreground">{day.day.slice(5)}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full bg-primary/80" style={{ width: `${Math.max(4, (day.costMicros / maxCost) * 100)}%` }} />
                </span>
                <span className="num text-end">{formatUsdFromMicros(day.costMicros)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card flex flex-col gap-3 p-4">
          <h2 className="text-sm text-muted-foreground">This week</h2>
          <p className="num text-lg">
            <NumberTicker value={stats.weekTokens} locale duration={0.16} stagger={0} />
            <span className="ms-2 text-sm font-sans text-muted-foreground">tokens</span>
          </p>
          <p className="num text-sm text-muted-foreground">
            <NumberTicker value={stats.weekDone} duration={0.16} stagger={0} /> marked done
          </p>
        </div>
      </section>
    </div>
  );
}
