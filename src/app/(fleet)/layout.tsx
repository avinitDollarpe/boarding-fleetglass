import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Shell } from "@/components/app/shell";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const plan = await readPlan(session.user.id);
  return (
    <Shell email={session.user.email}>
      {plan.override ? (
        <p className="mb-6 rounded-[8px] border border-border bg-muted px-3 py-2 text-sm">
          Local plan override is on. This banner cannot appear on Vercel.
        </p>
      ) : null}
      {children}
    </Shell>
  );
}
