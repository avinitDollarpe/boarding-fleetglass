import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { mintKey, revokeKey, saveAliases } from "@/app/actions";
import { Shell } from "@/components/app/shell";
import { listIngestKeys, listSlackAliases } from "@/server/keys";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const [plan, keys, aliases] = await Promise.all([
    readPlan(session.user.id),
    listIngestKeys(session.user.id),
    listSlackAliases(session.user.id),
  ]);
  return (
    <Shell email={session.user.email} planActive={plan.status === "active"}>
      <div className="flex max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cursor plan: {plan.status}
            {plan.email ? ` · ${plan.email}` : ""}
            {plan.hint ? ` · key ···${plan.hint}` : ""}
          </p>
        </div>
        <section className="card flex flex-col gap-3 p-4">
          <h2 className="text-lg font-medium">Ingest key</h2>
          <p className="text-sm text-muted-foreground">Gilfoyle and Chief call the API with this bearer token. It is shown once.</p>
          {query.key ? <p className="num break-all rounded-[8px] bg-muted p-3 text-sm">{query.key}</p> : null}
          <form action={mintKey} className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              Name
              <input name="name" defaultValue="Gilfoyle" className="field" />
            </label>
            <button type="submit" className="press btn btn-primary">
              Create key
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {key.name} ···{key.secretHint}
                  {key.revokedAt ? " · revoked" : ""}
                </span>
                {!key.revokedAt ? (
                  <form action={revokeKey}>
                    <input type="hidden" name="id" value={key.id} />
                    <button type="submit" className="press text-sm text-muted-foreground">
                      Revoke
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="card flex flex-col gap-3 p-4">
          <h2 className="text-lg font-medium">Slack aliases</h2>
          <p className="text-sm text-muted-foreground">
            Chief treats @cursor, the Cursor bot, and every name here as a mention. One alias per line. Chief owns the listener; this list is what it should read.
          </p>
          <form action={saveAliases} className="flex flex-col gap-3">
            <textarea name="aliases" defaultValue={aliases.join("\n")} className="field min-h-28 py-2" />
            <button type="submit" className="press btn btn-quiet w-fit">
              Save aliases
            </button>
          </form>
        </section>
      </div>
    </Shell>
  );
}
