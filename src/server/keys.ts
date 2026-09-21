import { and, eq, isNull } from "drizzle-orm";
import { pool, withUser } from "@/db/client";
import { integrations } from "@/db/schema";
import { decryptSecret, encryptSecret, hashSecret, hint, newIngestKey } from "@/lib/crypto";

export async function userIdForIngestKey(token: string): Promise<string | null> {
  const hash = hashSecret(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.key_hash', $1, true)", [hash]);
    const res = await client.query<{ user_id: string }>(
      `SELECT user_id FROM integrations
       WHERE provider = 'ingest' AND revoked_at IS NULL AND secret_hash = $1
       LIMIT 1`,
      [hash],
    );
    await client.query("COMMIT");
    return res.rows[0]?.user_id ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bearerUser(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return userIdForIngestKey(match[1].trim());
}

export async function listIngestKeys(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: integrations.id,
        name: integrations.name,
        secretHint: integrations.secretHint,
        createdAt: integrations.createdAt,
        revokedAt: integrations.revokedAt,
      })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "ingest"))),
  );
}

export async function createIngestKey(userId: string, name: string) {
  const secret = newIngestKey();
  const [row] = await withUser(userId, (tx) =>
    tx
      .insert(integrations)
      .values({
        userId,
        provider: "ingest",
        name: name.trim() || "Gilfoyle",
        secretHash: hashSecret(secret),
        secretEncrypted: encryptSecret(secret),
        secretHint: hint(secret),
      })
      .returning({ id: integrations.id, secretHint: integrations.secretHint, name: integrations.name }),
  );
  return { ...row, secret };
}

export async function revokeIngestKey(userId: string, id: string) {
  await withUser(userId, (tx) =>
    tx
      .update(integrations)
      .set({ revokedAt: new Date() })
      .where(and(eq(integrations.id, id), eq(integrations.userId, userId), isNull(integrations.revokedAt))),
  );
}

export async function cursorKeyForUser(userId: string): Promise<string | null> {
  const { cursorAccounts } = await import("@/db/schema");
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ apiKeyEncrypted: cursorAccounts.apiKeyEncrypted })
      .from(cursorAccounts)
      .where(eq(cursorAccounts.userId, userId)),
  );
  if (!row?.apiKeyEncrypted) return null;
  return decryptSecret(row.apiKeyEncrypted);
}
