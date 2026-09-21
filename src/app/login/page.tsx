import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requestMagicLink } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; check?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/board");
  const query = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm text-muted-foreground">Fleetglass</p>
        <h1 className="page-title mt-2">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">A magic link signs you in. The first one creates the account.</p>
      </div>
      <form action={requestMagicLink} className="card flex flex-col gap-3 p-4">
        <label htmlFor="email" className="text-sm">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field" />
        {query.error ? <p className="text-sm text-danger">That email did not work.</p> : null}
        {query.check ? (
          <p className="text-sm">
            Link sent. In local Docker, open <Link href="/dev/mailbox">the dev mailbox</Link> or the app logs.
          </p>
        ) : null}
        <button type="submit" className="press btn btn-primary">
          Send magic link
        </button>
      </form>
    </div>
  );
}
