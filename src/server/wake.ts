import pg from "pg";

/** One brief for Richard. Slack and GitHub both use this shape. */
export type RichardBrief =
  | {
      type: "fleetglass.wake";
      source: "slack";
      text: string;
      url: string;
      author: string;
      ids: {
        slack_ts: string;
        event_id: string | null;
        team_id: string;
        channel_id: string;
      };
      reply?: {
        url: string;
        exp: number;
        sig: string;
      };
    }
  | {
      type: "fleetglass.wake";
      source: "github";
      text: string;
      url: string;
      author: string;
      ids: {
        comment_id: string;
        repo: string;
        pr_number: number | null;
      };
    };

export type WakeDelivery =
  | { ok: true; woke: true; deduped: false }
  | { ok: true; woke: false; deduped: true }
  | { ok: true; woke: false; deduped: false; reason: "no_handoff" }
  | { ok: false; error: "wake_failed" };

const memory = new Set<string>();
let pool: pg.Pool | null = null;

function db(): pg.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 3 });
  return pool;
}

async function claimDb(key: string, source: string): Promise<"new" | "dup" | "off"> {
  const client = db();
  if (!client) return "off";
  try {
    const inserted = await client.query(
      `INSERT INTO wake_keys (idempotency_key, source)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING idempotency_key`,
      [key, source],
    );
    return inserted.rowCount ? "new" : "dup";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") return "off";
    throw error;
  }
}

async function releaseDb(key: string) {
  const client = db();
  if (!client) return;
  await client.query("DELETE FROM wake_keys WHERE idempotency_key = $1", [key]).catch(() => {});
}

async function claim(key: string, source: string): Promise<"new" | "dup"> {
  if (memory.has(key)) return "dup";
  const stored = await claimDb(key, source);
  if (stored === "dup") return "dup";
  memory.add(key);
  return "new";
}

async function release(key: string) {
  memory.delete(key);
  await releaseDb(key);
}

/**
 * POST `CHIEF_HANDOFF_URL` with the brief.
 * `CHIEF_HANDOFF_AUTHORIZATION`, when set, is sent as the Authorization header unchanged.
 * A repeated idempotency key does not POST again.
 * ponytail: process Set plus wake_keys. A crash after the claim and before a failed release can drop one retry if a second delivery already lost the race.
 */
export async function deliverRichardWake(brief: RichardBrief, idempotencyKey: string): Promise<WakeDelivery> {
  const url = process.env.CHIEF_HANDOFF_URL?.trim() || "";
  if (!url) return { ok: true, woke: false, deduped: false, reason: "no_handoff" };

  const claimed = await claim(idempotencyKey, brief.source);
  if (claimed === "dup") return { ok: true, woke: false, deduped: true };

  const authorization = process.env.CHIEF_HANDOFF_AUTHORIZATION?.trim();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(brief),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await release(idempotencyKey);
      return { ok: false, error: "wake_failed" };
    }
    return { ok: true, woke: true, deduped: false };
  } catch {
    await release(idempotencyKey);
    return { ok: false, error: "wake_failed" };
  }
}
