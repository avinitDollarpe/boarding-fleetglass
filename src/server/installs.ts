import { and, eq, isNull } from "drizzle-orm";
import { pool, withUser } from "@/db/client";
import { integrations } from "@/db/schema";
import {
  cleanHandle,
  cleanNameList,
  GITHUB_MENTION_TARGETS,
  SLACK_ALIASES,
  SLACK_CHANNEL_SCOPE,
  SLACK_DISPLAY_NAME,
  SLACK_HANDLE,
} from "@/lib/bots";
import { decryptSecret, encryptSecret, hashSecret, hint } from "@/lib/crypto";

export type SlackPublic = {
  id: string | null;
  displayName: string;
  handle: string;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  installed: boolean;
  hasSigningSecret: boolean;
  tokenHint: string;
  signingHint: string;
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
  apiAppId: string | null;
  ownerSlackUserIds: string[];
  ownerEmails: string[];
};

export type SlackSaveInput = {
  id?: string | null;
  displayName: string;
  handle: string;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  signingSecret?: string;
  botToken?: string;
  teamId?: string;
  apiAppId?: string;
  botUserId?: string;
  ownerSlackUserIds?: string[];
  ownerEmails?: string[];
};

export type GithubPublic = {
  mentionTargets: string[];
  enabled: boolean;
  installed: boolean;
  installationId: string | null;
};

type SlackRow = {
  id: string;
  userId: string;
  displayName: string | null;
  handle: string | null;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  externalTeamId: string | null;
  externalId: string | null;
  apiAppId: string | null;
  secretEncrypted: string;
  secretHint: string;
  signingSecretEncrypted: string;
  signingSecretHint: string;
  ownerSlackUserIds: string[];
  ownerEmails: string[];
  metadata: Record<string, unknown>;
};

const slackColumns = {
  id: integrations.id,
  userId: integrations.userId,
  displayName: integrations.displayName,
  handle: integrations.handle,
  aliases: integrations.aliases,
  channelAllowlist: integrations.channelAllowlist,
  enabled: integrations.enabled,
  externalTeamId: integrations.externalTeamId,
  externalId: integrations.externalId,
  apiAppId: integrations.apiAppId,
  secretEncrypted: integrations.secretEncrypted,
  secretHint: integrations.secretHint,
  signingSecretEncrypted: integrations.signingSecretEncrypted,
  signingSecretHint: integrations.signingSecretHint,
  ownerSlackUserIds: integrations.ownerSlackUserIds,
  ownerEmails: integrations.ownerEmails,
  metadata: integrations.metadata,
};

function pendingHash(provider: string, userId: string): string {
  return hashSecret(`pending:${provider}:${userId}`);
}

function asMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function blankSlack(): SlackPublic {
  return {
    id: null,
    displayName: SLACK_DISPLAY_NAME,
    handle: SLACK_HANDLE,
    aliases: [...SLACK_ALIASES],
    channelAllowlist: [SLACK_CHANNEL_SCOPE],
    enabled: false,
    installed: false,
    hasSigningSecret: false,
    tokenHint: "",
    signingHint: "",
    teamId: null,
    teamName: null,
    botUserId: null,
    apiAppId: null,
    ownerSlackUserIds: [],
    ownerEmails: [],
  };
}

function slackPublic(row: SlackRow): SlackPublic {
  const meta = asMeta(row.metadata);
  const teamName = typeof meta.teamName === "string" ? meta.teamName : null;
  return {
    id: row.id,
    displayName: row.displayName || SLACK_DISPLAY_NAME,
    handle: row.handle || SLACK_HANDLE,
    aliases: row.aliases ?? [],
    channelAllowlist: row.channelAllowlist ?? [],
    enabled: row.enabled,
    installed: Boolean(row.secretEncrypted && row.externalTeamId),
    hasSigningSecret: Boolean(row.signingSecretEncrypted),
    tokenHint: row.secretHint,
    signingHint: row.signingSecretHint,
    teamId: row.externalTeamId,
    teamName,
    botUserId: row.externalId,
    apiAppId: row.apiAppId,
    ownerSlackUserIds: row.ownerSlackUserIds ?? [],
    ownerEmails: row.ownerEmails ?? [],
  };
}

function githubPublic(row: {
  mentionTargets: string[];
  enabled: boolean;
  externalId: string | null;
} | undefined): GithubPublic {
  return {
    mentionTargets: row?.mentionTargets?.length ? row.mentionTargets : [...GITHUB_MENTION_TARGETS],
    enabled: row?.enabled ?? false,
    installed: Boolean(row?.externalId),
    installationId: row?.externalId ?? null,
  };
}

export async function listSlack(userId: string): Promise<SlackPublic[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select(slackColumns)
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt))),
  );
  return rows.map(slackPublic);
}

export async function readSlack(userId: string): Promise<SlackPublic> {
  const [first] = await listSlack(userId);
  return first ?? blankSlack();
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

function cleanEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!email.includes("@") || email.length > 200 || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 20) break;
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "23505") return true;
  return "cause" in error && isUniqueViolation((error as { cause?: unknown }).cause);
}

function cleanSlackId(value: string | undefined): string | null {
  const id = (value ?? "").trim();
  if (!id || id.length > 32 || !/^[A-Z0-9]+$/i.test(id)) return null;
  return id;
}

export async function saveSlackSettings(
  userId: string,
  input: SlackSaveInput,
): Promise<{ ok: true } | { ok: false; error: "incomplete" | "duplicate" | "missing" }> {
  const displayName = input.displayName.trim().slice(0, 80) || SLACK_DISPLAY_NAME;
  const handle = cleanHandle(input.handle);
  const aliases = cleanNameList(input.aliases);
  const channelAllowlist = cleanNameList(input.channelAllowlist);
  const ownerSlackUserIds = input.ownerSlackUserIds ? cleanNameList(input.ownerSlackUserIds) : null;
  const ownerEmails = input.ownerEmails ? cleanEmails(input.ownerEmails) : null;
  const teamId = cleanSlackId(input.teamId);
  const apiAppId = cleanSlackId(input.apiAppId);
  const botUserId = cleanSlackId(input.botUserId);
  const signingSecret = input.signingSecret?.trim() || "";
  const botToken = input.botToken?.trim() || "";

  try {
    return await withUser(userId, async (tx) => {
      const [existing] = input.id
        ? await tx
            .select({
              id: integrations.id,
              secretEncrypted: integrations.secretEncrypted,
              signingSecretEncrypted: integrations.signingSecretEncrypted,
              externalTeamId: integrations.externalTeamId,
              externalId: integrations.externalId,
              apiAppId: integrations.apiAppId,
              ownerSlackUserIds: integrations.ownerSlackUserIds,
              ownerEmails: integrations.ownerEmails,
            })
            .from(integrations)
            .where(and(eq(integrations.id, input.id), eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt)))
        : [];
      if (input.id && !existing) return { ok: false as const, error: "missing" as const };

      const nextToken = botToken || existing?.secretEncrypted || "";
      const nextSigning = signingSecret || existing?.signingSecretEncrypted || "";
      const nextTeam = teamId || existing?.externalTeamId || null;
      const nextApp = apiAppId || existing?.apiAppId || null;
      const nextBot = botUserId || existing?.externalId || null;
      const nextOwners = ownerSlackUserIds ?? existing?.ownerSlackUserIds ?? [];
      const nextEmails = ownerEmails ?? existing?.ownerEmails ?? [];
      const ready = Boolean(nextToken && nextSigning && nextTeam && (nextOwners.length > 0 || nextEmails.length > 0));
      const enabled = input.enabled && ready;

      const patch = {
        displayName,
        handle,
        aliases,
        channelAllowlist,
        enabled,
        name: displayName,
        externalTeamId: nextTeam,
        externalId: nextBot,
        apiAppId: nextApp,
        ownerSlackUserIds: nextOwners,
        ownerEmails: nextEmails,
        ...(botToken
          ? { secretHash: hashSecret(botToken), secretEncrypted: encryptSecret(botToken), secretHint: hint(botToken) }
          : {}),
        ...(signingSecret
          ? { signingSecretEncrypted: encryptSecret(signingSecret), signingSecretHint: hint(signingSecret) }
          : {}),
      };
      if (existing) {
        await tx.update(integrations).set(patch).where(eq(integrations.id, existing.id));
      } else {
        await tx.insert(integrations).values({
          userId,
          provider: "slack",
          secretHash: botToken ? hashSecret(botToken) : pendingHash("slack", userId),
          secretEncrypted: botToken ? encryptSecret(botToken) : "",
          secretHint: botToken ? hint(botToken) : "",
          signingSecretEncrypted: signingSecret ? encryptSecret(signingSecret) : "",
          signingSecretHint: signingSecret ? hint(signingSecret) : "",
          ...patch,
        });
      }
      if (input.enabled && !ready) return { ok: false as const, error: "incomplete" as const };
      return { ok: true as const };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "duplicate" };
    throw error;
  }
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
  install: { token: string; teamId: string; teamName: string; botUserId: string; apiAppId?: string | null },
) {
  const encrypted = encryptSecret(install.token);
  const apiAppId = cleanSlackId(install.apiAppId ?? undefined);
  await withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: integrations.id,
        externalTeamId: integrations.externalTeamId,
        signingSecretEncrypted: integrations.signingSecretEncrypted,
        ownerSlackUserIds: integrations.ownerSlackUserIds,
        ownerEmails: integrations.ownerEmails,
      })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt)));
    const existing = rows.find((row) => row.externalTeamId === install.teamId) ?? rows.find((row) => !row.externalTeamId);
    const ready = Boolean(
      existing?.signingSecretEncrypted &&
        ((existing.ownerSlackUserIds?.length ?? 0) > 0 || (existing.ownerEmails?.length ?? 0) > 0),
    );
    const patch = {
      secretHash: hashSecret(install.token),
      secretEncrypted: encrypted,
      secretHint: hint(install.token),
      externalTeamId: install.teamId,
      externalId: install.botUserId,
      apiAppId,
      metadata: { teamName: install.teamName },
      enabled: ready,
    };
    if (existing) {
      await tx.update(integrations).set(patch).where(eq(integrations.id, existing.id));
      return;
    }
    await tx.insert(integrations).values({
      userId,
      provider: "slack",
      name: SLACK_DISPLAY_NAME,
      displayName: SLACK_DISPLAY_NAME,
      handle: SLACK_HANDLE,
      aliases: [...SLACK_ALIASES],
      channelAllowlist: [SLACK_CHANNEL_SCOPE],
      signingSecretEncrypted: "",
      signingSecretHint: "",
      ...patch,
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

export async function disconnectSlack(userId: string, connectionId: string) {
  if (!connectionId) return;
  await withUser(userId, (tx) =>
    tx
      .update(integrations)
      .set({
        secretEncrypted: "",
        secretHint: "",
        secretHash: pendingHash("slack", userId),
        signingSecretEncrypted: "",
        signingSecretHint: "",
        enabled: false,
        revokedAt: new Date(),
      })
      .where(and(eq(integrations.id, connectionId), eq(integrations.userId, userId), eq(integrations.provider, "slack"), isNull(integrations.revokedAt))),
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

export type SlackSecretConnection = {
  id: string;
  userId: string;
  teamId: string | null;
  apiAppId: string | null;
  botUserId: string | null;
  signingSecret: string;
  botToken: string;
  displayName: string;
  handle: string;
  aliases: string[];
  channelAllowlist: string[];
  enabled: boolean;
  ownerSlackUserIds: string[];
  ownerEmails: string[];
};

type SecretRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  handle: string | null;
  aliases: string[] | null;
  channel_allowlist: string[] | null;
  enabled: boolean;
  external_team_id: string | null;
  external_id: string | null;
  api_app_id: string | null;
  secret_encrypted: string;
  signing_secret_encrypted: string;
  owner_slack_user_ids: string[] | null;
  owner_emails: string[] | null;
};

function secretConnection(row: SecretRow): SlackSecretConnection | null {
  if (!row.signing_secret_encrypted) return null;
  let signingSecret = "";
  let botToken = "";
  try {
    signingSecret = decryptSecret(row.signing_secret_encrypted);
    botToken = row.secret_encrypted ? decryptSecret(row.secret_encrypted) : "";
  } catch {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.external_team_id,
    apiAppId: row.api_app_id,
    botUserId: row.external_id,
    signingSecret,
    botToken,
    displayName: row.display_name || SLACK_DISPLAY_NAME,
    handle: row.handle || SLACK_HANDLE,
    aliases: row.aliases ?? [],
    channelAllowlist: row.channel_allowlist ?? [],
    enabled: row.enabled,
    ownerSlackUserIds: row.owner_slack_user_ids ?? [],
    ownerEmails: row.owner_emails ?? [],
  };
}

const SECRET_SQL = `SELECT id, user_id, display_name, handle, aliases, channel_allowlist, enabled,
  external_team_id, external_id, api_app_id, secret_encrypted, signing_secret_encrypted,
  owner_slack_user_ids, owner_emails
  FROM integrations
  WHERE provider = 'slack' AND revoked_at IS NULL AND signing_secret_encrypted <> ''`;

async function loadSlackSecrets(config: "resolve" | "team", teamId?: string): Promise<SlackSecretConnection[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (config === "resolve") {
      await client.query("SELECT set_config('app.slack_resolve', '1', true)");
    } else {
      await client.query("SELECT set_config('app.slack_team', $1, true)", [teamId ?? ""]);
    }
    const res = await client.query<SecretRow>(
      config === "team" ? `${SECRET_SQL} AND external_team_id = $1` : SECRET_SQL,
      config === "team" ? [teamId ?? ""] : [],
    );
    await client.query("COMMIT");
    return res.rows.map(secretConnection).filter((row): row is SlackSecretConnection => row !== null);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Every Slack connector that has a signing secret. Used for url_verification, which has no team id. */
export function listSlackSigningConnections(): Promise<SlackSecretConnection[]> {
  return loadSlackSecrets("resolve");
}

export function slackConnectionsForTeam(teamId: string): Promise<SlackSecretConnection[]> {
  return loadSlackSecrets("team", teamId);
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
