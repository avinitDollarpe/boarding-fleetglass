import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requestMagicLink } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string; check?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/board");
  const query = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Fleetglass</p>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight">The board Gilfoyle writes before a cloud agent starts.</h1>
        <p className="max-w-xl text-muted-foreground">
          The Fleetglass Slack bot or GitHub App hears a mention, or you delegate in chat. Gilfoyle opens the task here. An active Cursor plan launches the agent. Anything else stays in blocked:cursor_plan.
        </p>
      </div>
      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["1", "Chief receives the trigger and hands Gilfoyle the context."],
          ["2", "Fleetglass records the task once, even if the webhook repeats."],
          ["3", "The plan gate launches Cursor, or blocks the task."],
        ].map(([n, copy]) => (
          <li key={n} className="card p-4">
            <div className="num text-muted-foreground">{n}</div>
            <p className="mt-2">{copy}</p>
          </li>
        ))}
      </ol>
      <form action={requestMagicLink} className="card flex flex-col gap-3 p-4 sm:max-w-md">
        <label htmlFor="email" className="text-sm">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" placeholder="you@company.com" />
        {query.error === "email" ? <p className="text-sm text-[oklch(0.78_0.14_25)]">Enter a valid email.</p> : null}
        {query.check ? <p className="text-sm">Check your email for the sign-in link.</p> : null}
        <button type="submit" className="press btn btn-primary">
          Email me a link
        </button>
        <p className="text-xs text-muted-foreground">
          The first link creates your fleet. <Link href="/login">Sign in</Link> uses the same form.
        </p>
      </form>
    </div>
  );
}
