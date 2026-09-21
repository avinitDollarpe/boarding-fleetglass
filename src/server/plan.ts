import { eq } from "drizzle-orm";
import { withUser } from "@/db/client";
import { cursorAccounts } from "@/db/schema";
import { planOverride } from "@/lib/plan";
import { encryptSecret, hint } from "@/lib/crypto";
import { fetchCursorPlan } from "@/server/cursor";
import { cursorKeyForUser } from "@/server/keys";

export type StoredPlan = {
  status: "active" | "inactive" | "unlinked";
  reason: string | null;
  email: string | null;
  checkedAt: Date | null;
  hint: string | null;
  override: boolean;
};

function overridePlan(): StoredPlan | null {
  const override = planOverride();
  if (!override) return null;
  return {
    status: override,
    reason: "dev_override",
    email: null,
    checkedAt: new Date(),
    hint: null,
    override: true,
  };
}

export async function readPlan(userId: string): Promise<StoredPlan> {
  const forced = overridePlan();
  if (forced) return forced;
  const [row] = await withUser(userId, (tx) =>
    tx.select().from(cursorAccounts).where(eq(cursorAccounts.userId, userId)),
  );
  if (!row) {
    return { status: "unlinked", reason: null, email: null, checkedAt: null, hint: null, override: false };
  }
  const status = row.planStatus === "active" || row.planStatus === "inactive" ? row.planStatus : "unlinked";
  return {
    status,
    reason: row.planReason,
    email: row.cursorEmail,
    checkedAt: row.planCheckedAt,
    hint: row.apiKeyHint,
    override: false,
  };
}

export async function linkCursorKey(userId: string, apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length < 12) throw new Error("Paste a Cursor API key");
  const encrypted = encryptSecret(trimmed);
  const keyHint = hint(trimmed);
  await withUser(userId, async (tx) => {
    const [existing] = await tx.select({ id: cursorAccounts.id }).from(cursorAccounts).where(eq(cursorAccounts.userId, userId));
    if (existing) {
      await tx
        .update(cursorAccounts)
        .set({ apiKeyEncrypted: encrypted, apiKeyHint: keyHint, updatedAt: new Date() })
        .where(eq(cursorAccounts.userId, userId));
    } else {
      await tx.insert(cursorAccounts).values({
        userId,
        apiKeyEncrypted: encrypted,
        apiKeyHint: keyHint,
        planStatus: "unlinked",
      });
    }
  });
  return verifyPlan(userId);
}

export async function verifyPlan(userId: string): Promise<StoredPlan> {
  const forced = overridePlan();
  if (forced) {
    await withUser(userId, async (tx) => {
      const [existing] = await tx.select({ id: cursorAccounts.id }).from(cursorAccounts).where(eq(cursorAccounts.userId, userId));
      const patch = {
        planStatus: forced.status,
        planReason: "dev_override",
        planCheckedAt: new Date(),
        updatedAt: new Date(),
      };
      if (existing) {
        await tx.update(cursorAccounts).set(patch).where(eq(cursorAccounts.userId, userId));
      } else {
        await tx.insert(cursorAccounts).values({ userId, ...patch });
      }
    });
    return forced;
  }

  const apiKey = await cursorKeyForUser(userId);
  if (!apiKey) {
    return { status: "unlinked", reason: "cursor_auth_failed", email: null, checkedAt: null, hint: null, override: false };
  }
  const probe = await fetchCursorPlan(apiKey);
  const status = probe.active ? "active" : "inactive";
  await withUser(userId, (tx) =>
    tx
      .update(cursorAccounts)
      .set({
        planStatus: status,
        planReason: probe.reason,
        planCheckedAt: new Date(),
        cursorEmail: probe.email,
        cursorUserId: probe.cursorUserId,
        planRaw: probe.raw,
        updatedAt: new Date(),
      })
      .where(eq(cursorAccounts.userId, userId)),
  );
  return {
    status,
    reason: probe.reason,
    email: probe.email,
    checkedAt: new Date(),
    hint: hint(apiKey),
    override: false,
  };
}
