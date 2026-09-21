import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_MIGRATE or DATABASE_URL is required");
  process.exit(1);
}

async function connect() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("database unreachable");
}

const client = await connect();
await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
const dir = path.join(process.cwd(), "drizzle");
const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
for (const file of files) {
  const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
  if (applied.rowCount) continue;
  const sql = await readFile(path.join(dir, file), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
await client.end();
