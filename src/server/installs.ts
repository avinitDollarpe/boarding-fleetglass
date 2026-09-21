import { and, eq, isNull } from "drizzle-orm";
import { pool, withUser } from "@/db/client";
import { integrations } from "@/db/schema";
import { cleanHandle, cleanNameList } from "@/lib/bots";
import { decryptSecret, encryptSecret, hashSecret, hint } from "@/lib/crypto";

export type SlackPublic = {
  displayName: string;
  handle: string;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  installed: boolean;
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
};

export type GithubPublic = {
  mentionTargets: string[];
  enabled: boolean;
  installed: boolean;
  installationId: string | null;
};

type SlackRow = {
  userId: string;
  displayName: string | null;
  handle: string | null;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  externalTeamId: string | null;
  externalId: string | null;
  secretEncrypted: string;
  metadata: Record<string, unknown>;
};

function pendingHash(provider: string, userId: string): string {
  return hashSecret(`pending:${provider}:${userId}`);
}

function asMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function slackPublic(row: SlackRow | undefined): SlackPublic {
  const meta = asMeta(row?.metadata);
  const teamName = typeof meta.teamName === "string" ? meta.teamName : null;
  return {
    displayName: row?.displayName || "Fleetglass",
    handle: row?.handle || "Fleetglass",
    aliases: row?.aliases ?? [],
    channelAllowlist: row?.channelAllowlist ?? [],
    enabled: row?.enabled ?? false,
    installed: Boolean(row?.secretEncrypted && row.externalTeamId),
    teamId: row?.externalTeamId ?? null,
    teamName,
    botUserId: row?.externalId ?? null,
  };
}

function githubPublic(row: {
  mentionTargets: string[];
  enabled: boolean;
  externalId: string | null;
} | undefined): GithubPublic {
  return {
    mentionTargets: row?.mentionTargets ?? [],
    enabled: row?.enabled ?? false,
    installed: Boolean(row?.externalId),
    installationId: row?.externalId ?? null,
  };
}

export async function readSlack(userId: string): Promise<SlackPublic> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        userId: integrations.userId,
        displayName: integrations.displayName,
        handle: integrations.handle,
        aliases: integrations.aliases,
        channelAllowlist: integrations.channelAllowlist,
        enabled: integrations.enabled,
        externalTeamId: integrations.externalTeamId,
        externalId: integrations.externalId,
        secretEncrypted: integrations.secretEncrypted,
        metadata: integrations.metadata,
      })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt))),
  );
  return slackPublic(row);
}

export async function readGithub(userId: string): Promise<GithubPublic> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        mentionTargets: integrations.mentionTargets,
        enabled: integrations.enabled,
        externalId: integrations.externalId,
      })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github"), isNull(integrations.revokedAt))),
  );
  return githubPublic(row);
}

export async function saveSlackSettings(
  userId: string,
  input: { displayName: string; handle: string; aliases: string[]; channelAllowlist: string[]; enabled: boolean },
) {
  const displayName = input.displayName.trim().slice(0, 80) || "Fleetglass";
  const handle = cleanHandle(input.handle);
  const aliases = cleanNameList(input.aliases);
  const channelAllowlist = cleanNameList(input.channelAllowlist);
  await withUser(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt)));
    if (existing) {
      await tx
        .update(integrations)
        .set({ displayName, handle, aliases, channelAllowlist, enabled: input.enabled, name: displayName })
        .where(eq(integrations.id, existing.id));
      return;
    }
    await tx.insert(integrations).values({
      userId,
      provider: "slack",
      name: displayName,
      secretHash: pendingHash("slack", userId),
      secretEncrypted: "",
      secretHint: "",
      displayName,
      handle,
      aliases,
      channelAllowlist,
      enabled: input.enabled,
    });
  });
}

export async function saveGithubSettings(userId: string, input: { mentionTargets: string[]; enabled: boolean }) {
  const mentionTargets = cleanNameList(input.mentionTargets);
  await withUser(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github"), isNull(integrations.revokedAt)));
    if (existing) {
      await tx
        .update(integrations)
        .set({ mentionTargets, enabled: input.enabled })
        .where(eq(integrations.id, existing.id));
      return;
    }
    await tx.insert(integrations).values({
      userId,
      provider: "github",
      name: "Fleetglass GitHub App",
      secretHash: pendingHash("github", userId),
      secretEncrypted: "",
      secretHint: "",
      mentionTargets,
      enabled: input.enabled,
    });
  });
}

export async function storeSlackInstall(
  userId: string,
  install: { token: string; teamId: string; teamName: string; botUserId: string },
) {
  const current = await readSlack(userId);
  const encrypted = encryptSecret(install.token);
  const patch = {
    secretHash: hashSecret(install.token),
    secretEncrypted: encrypted,
    secretHint: hint(install.token),
    externalTeamId: install.teamId,
    externalId: install.botUserId,
    enabled: true,
    displayName: current.displayName,
    handle: current.handle,
    metadata: { teamName: install.teamName },
    name: current.displayName,
  };
  await withUser(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt)));
    if (existing) {
      await tx.update(integrations).set(patch).where(eq(integrations.id, existing.id));
      return;
    }
    await tx.insert(integrations).values({
      userId,
      provider: "slack",
      secretHash: patch.secretHash,
      secretEncrypted: patch.secretEncrypted,
      secretHint: patch.secretHint,
      externalTeamId: install.teamId,
      externalId: install.botUserId,
      enabled: true,
      displayName: "Fleetglass",
      handle: "Fleetglass",
      name: "Fleetglass",
      metadata: { teamName: install.teamName },
    });
  });
}

export async function storeGithubInstall(userId: string, installationId: string) {
  await withUser(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github"), isNull(integrations.revokedAt)));
    const patch = {
      externalId: installationId,
      enabled: true,
      secretHash: hashSecret(`github-installation:${installationId}`),
    };
    if (existing) {
      await tx.update(integrations).set(patch).where(eq(integrations.id, existing.id));
      return;
    }
    await tx.insert(integrations).values({
      userId,
      provider: "github",
      name: "Fleetglass GitHub App",
      secretEncrypted: "",
      secretHint: "",
      ...patch,
    });
  });
}

export async function disconnectSlack(userId: string) {
  await withUser(userId, (tx) =>
    tx
      .update(integrations)
      .set({
        secretEncrypted: "",
        secretHint: "",
        secretHash: pendingHash("slack", userId),
        externalTeamId: null,
        externalId: null,
        enabled: false,
        metadata: {},
      })
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt))),
  );
}

export async function disconnectGithub(userId: string) {
  await withUser(userId, (tx) =>
    tx
      .update(integrations)
      .set({
        externalId: null,
        enabled: false,
        secretHash: pendingHash("github", userId),
      })
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "github"), isNull(integrations.revokedAt))),
  );
}

export type SlackInstall = SlackPublic & { userId: string; token: string };

export async function slackInstallForTeam(teamId: string): Promise<SlackInstall | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.slack_team', $1, true)", [teamId]);
    const res = await client.query<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      aliases: string[] | null;
      channel_allowlist: string[] | null;
      enabled: boolean;
      external_team_id: string | null;
      external_id: string | null;
      secret_encrypted: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT user_id, display_name, handle, aliases, channel_allowlist, enabled,
              external_team_id, external_id, secret_encrypted, metadata
       FROM integrations
       WHERE provider = 'slack' AND revoked_at IS NULL AND external_team_id = $1
       LIMIT 1`,
      [teamId],
    );
    await client.query("COMMIT");
    const row = res.rows[0];
    if (!row?.secret_encrypted) return null;
    const pub = slackPublic({
      userId: row.user_id,
      displayName: row.display_name,
      handle: row.handle,
      aliases: row.aliases ?? [],
      channelAllowlist: row.channel_allowlist ?? [],
      enabled: row.enabled,
      externalTeamId: row.external_team_id,
      externalId: row.external_id,
      secretEncrypted: row.secret_encrypted,
      metadata: asMeta(row.metadata),
    });
    return { ...pub, userId: row.user_id, token: decryptSecret(row.secret_encrypted) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type GithubInstall = GithubPublic & { userId: string };

export async function githubInstallForId(installationId: string): Promise<GithubInstall | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.github_installation', $1, true)", [installationId]);
    const res = await client.query<{
      user_id: string;
      mention_targets: string[] | null;
      enabled: boolean;
      external_id: string | null;
    }>(
      `SELECT user_id, mention_targets, enabled, external_id
       FROM integrations
       WHERE provider = 'github' AND revoked_at IS NULL AND external_id = $1
       LIMIT 1`,
      [installationId],
    );
    await client.query("COMMIT");
    const row = res.rows[0];
    if (!row) return null;
    return { ...githubPublic(row ? { mentionTargets: row.mention_targets ?? [], enabled: row.enabled, externalId: row.external_id } : undefined), userId: row.user_id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
