import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForPg = globalThis as unknown as { pool?: Pool };

function makePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  return new Pool({ connectionString, max: 10 });
}

export const pool = globalForPg.pool ?? makePool();

if (process.env.NODE_ENV !== "production") globalForPg.pool = pool;

export const db = drizzle(pool, { schema });

export type AppDb = NodePgDatabase<typeof schema>;

export async function withUser<T>(userId: string, fn: (tx: AppDb) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
