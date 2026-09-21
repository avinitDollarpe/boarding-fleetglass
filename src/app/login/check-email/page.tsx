import Link from "next/link";

export const dynamic = "force-dynamic";

export default function CheckEmailPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm text-muted-foreground">Fleetglass</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A sign-in link is on its way. It expires in 24 hours. In local Docker, the same link is listed in the dev mailbox and printed in the app logs.
        </p>
      </div>
      <div className="card flex flex-col gap-3 p-4">
        <Link href="/dev/mailbox" className="press btn btn-primary">
          Open dev mailbox
        </Link>
        <Link href="/login" className="press btn btn-quiet">
          Use a different email
        </Link>
      </div>
    </div>
  );
}
