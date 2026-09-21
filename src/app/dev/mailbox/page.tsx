import { notFound } from "next/navigation";
import { pool } from "@/db/client";

export const dynamic = "force-dynamic";

export default async function MailboxPage() {
  if (process.env.DEV_MAILBOX !== "1" || process.env.VERCEL) notFound();
  const rows = await pool.query<{ identifier: string; url: string; created_at: Date }>(
    "SELECT identifier, url, created_at FROM dev_mailbox ORDER BY created_at DESC LIMIT 20",
  );
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Dev mailbox</h1>
      <p className="text-sm text-muted-foreground">Local only. These links never render when VERCEL is set.</p>
      <ul className="flex flex-col gap-3">
        {rows.rows.map((row) => (
          <li key={row.url} className="card p-4 text-sm">
            <div>{row.identifier}</div>
            <a className="mt-2 inline-flex text-primary" href={row.url}>
              Open magic link
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
