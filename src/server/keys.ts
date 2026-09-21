import { and, eq, isNull } from "drizzle-orm";
import { pool, withUser } from "@/db/client";
import { integrations, mentionAliases } from "@/db/schema";
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
      .where(eq(integrations.userId, userId)),
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

export async function listSlackAliases(userId: string): Promise<string[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ alias: mentionAliases.alias })
      .from(mentionAliases)
      .where(and(eq(mentionAliases.userId, userId), eq(mentionAliases.kind, "slack"))),
  );
  return rows.map((row) => row.alias);
}

export async function replaceSlackAliases(userId: string, aliases: string[]) {
  const cleaned = [...new Set(aliases.map((alias) => alias.trim().replace(/^@/, "")).filter(Boolean))].slice(0, 40);
  await withUser(userId, async (tx) => {
    await tx.delete(mentionAliases).where(and(eq(mentionAliases.userId, userId), eq(mentionAliases.kind, "slack")));
    if (cleaned.length) {
      await tx.insert(mentionAliases).values(
        cleaned.map((alias) => ({ userId, kind: "slack", alias })),
      );
    }
  });
  return cleaned;
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
