import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

async function withUser<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const a = (await pool.query<{ id: string }>(
  "INSERT INTO users (email) VALUES ($1) RETURNING id",
  [`rls-a-${Date.now()}@fleetglass.local`],
)).rows[0].id;
const b = (await pool.query<{ id: string }>(
  "INSERT INTO users (email) VALUES ($1) RETURNING id",
  [`rls-b-${Date.now()}@fleetglass.local`],
)).rows[0].id;

const taskId = await withUser(a, async (client) => {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO tasks (user_id, name, state, trigger, source, idempotency_key)
     VALUES ($1, 'rls', 'Holding', 'chat_delegate', 'chat_delegate', $2)
     RETURNING id`,
    [a, `rls-${Date.now()}`],
  );
  return inserted.rows[0].id;
});

const seenByB = await withUser(b, async (client) => {
  const rows = await client.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
  return rows.rowCount;
});
assert.equal(seenByB, 0);

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const open = await client.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
  await client.query("ROLLBACK");
  assert.equal(open.rowCount, 0);
} finally {
  client.release();
}

const seenByA = await withUser(a, async (client) => (await client.query("SELECT id FROM tasks WHERE id = $1", [taskId])).rowCount);
assert.equal(seenByA, 1);

await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[a, b]]);
await pool.end();
console.log("rls checks ok");
