import type { ThreadWatch } from "@/lib/thread-watch";
import { db } from "@/server/db";

const memory = new Map<string, ThreadWatch>();

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
