import type { ThreadWatch } from "@/lib/thread-watch";
import { db } from "@/server/db";

const memory = new Map<string, ThreadWatch>();
const lastSeen = new Map<string, number>();

/** A watch with no mention or follow-up wake for this long stops waking Richard. */
export const THREAD_WATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function watchKey(channelId: string, threadTs: string): string {
  return `${channelId}\n${threadTs}`;
}

type WatchRow = {
  channel_id: string;
  thread_ts: string;
  refs: string[] | null;
  owner_id: string;
  created_at: Date | string;
};

function fromRow(row: WatchRow): ThreadWatch {
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    refs: row.refs ?? [],
    ownerId: row.owner_id,
    createdAt: created.toISOString(),
  };
}

async function upsertDb(watch: ThreadWatch): Promise<ThreadWatch | null> {
  const client = db();
  if (!client) return null;
  try {
    const inserted = await client.query<WatchRow>(
      `INSERT INTO thread_watches (channel_id, thread_ts, refs, owner_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, thread_ts) DO UPDATE
       SET refs = EXCLUDED.refs, owner_id = EXCLUDED.owner_id
       RETURNING channel_id, thread_ts, refs, owner_id, created_at`,
      [watch.channelId, watch.threadTs, watch.refs, watch.ownerId],
    );
    const row = inserted.rows[0];
    return row ? fromRow(row) : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P01") console.error("thread watch save failed", code ?? "unknown");
    return null;
  }
}

async function readDb(channelId: string, threadTs: string): Promise<ThreadWatch | null> {
  const client = db();
  if (!client) return null;
  try {
    const found = await client.query<WatchRow>(
      `SELECT channel_id, thread_ts, refs, owner_id, created_at
       FROM thread_watches
       WHERE channel_id = $1 AND thread_ts = $2`,
      [channelId, threadTs],
    );
    const row = found.rows[0];
    return row ? fromRow(row) : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P01") console.error("thread watch read failed", code ?? "unknown");
    return null;
  }
}

export async function saveThreadWatch(input: {
  channelId: string;
  threadTs: string;
  refs: string[];
  ownerId: string;
}): Promise<ThreadWatch> {
  const key = watchKey(input.channelId, input.threadTs);
  const prior = memory.get(key);
  const draft: ThreadWatch = {
    channelId: input.channelId,
    threadTs: input.threadTs,
    refs: input.refs,
    ownerId: input.ownerId,
    createdAt: prior?.createdAt ?? new Date().toISOString(),
  };
  const stored = await upsertDb(draft);
  const saved = stored ?? draft;
  memory.set(key, saved);
  return saved;
}

export async function getThreadWatch(channelId: string, threadTs: string): Promise<ThreadWatch | null> {
  const stored = await readDb(channelId, threadTs);
  if (stored) {
    memory.set(watchKey(channelId, threadTs), stored);
    return stored;
  }
  return memory.get(watchKey(channelId, threadTs)) ?? null;
}

/** Auto-watch after a mention wake. Keeps an existing watch, refs included, and restarts its expiry. */
export async function ensureThreadWatch(
  input: { channelId: string; threadTs: string; ownerId: string },
  now = Date.now(),
): Promise<void> {
  const key = watchKey(input.channelId, input.threadTs);
  const client = db();
  if (client) {
    try {
      await client.query(
        `INSERT INTO thread_watches (channel_id, thread_ts, owner_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, thread_ts) DO UPDATE SET last_seen_at = now()`,
        [input.channelId, input.threadTs, input.ownerId],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01") console.error("thread watch save failed", code ?? "unknown");
    }
  }
  if (!memory.has(key)) {
    memory.set(key, { ...input, refs: [], createdAt: new Date(now).toISOString() });
  }
  lastSeen.set(key, now);
}

/** True when the thread is watched and not expired. A live watch restarts its expiry. */
export async function touchThreadWatch(channelId: string, threadTs: string, now = Date.now()): Promise<boolean> {
  const key = watchKey(channelId, threadTs);
  const client = db();
  if (client) {
    try {
      const touched = await client.query(
        `UPDATE thread_watches SET last_seen_at = now()
         WHERE channel_id = $1 AND thread_ts = $2 AND last_seen_at > now() - $3 * interval '1 millisecond'
         RETURNING 1`,
        [channelId, threadTs, THREAD_WATCH_TTL_MS],
      );
      if (touched.rowCount) {
        lastSeen.set(key, now);
        return true;
      }
      return false;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01") console.error("thread watch touch failed", code ?? "unknown");
    }
  }
  if (!memory.has(key)) return false;
  // Explicit watches saved before any wake count from their creation.
  const seen = lastSeen.get(key) ?? Date.parse(memory.get(key)?.createdAt ?? "");
  if (!(now - seen < THREAD_WATCH_TTL_MS)) return false;
  lastSeen.set(key, now);
  return true;
}
