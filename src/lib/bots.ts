const NAME = /^@?([a-z0-9][a-z0-9._-]{0,79})$/i;

/** GitHub logins whose PR comments count. Includes the Cursor bot names. */
export const GITHUB_MENTION_TARGETS = ["avinitDollarpe", "cursor", "cursoragent"] as const;

/** Owners whose repos are in scope: the DollarPe-Infra org and the avinitDollarpe user. */
export const GITHUB_REPO_OWNERS = ["DollarPe-Infra", "avinitDollarpe"] as const;

/** Slack aliases Richard matches, besides the @richard handle. Channel scope is `*`. */
export const SLACK_ALIASES = ["cursoragent", "cursor", "cursor bot", "Cursor"] as const;

export const SLACK_CHANNEL_SCOPE = "*";

export const SLACK_DISPLAY_NAME = "Richard";

export const SLACK_HANDLE = "richard";

/** Slack user who may mention Richard. `SLACK_MENTION_USER_ID` overrides this. */
export const SLACK_MENTION_USER_DEFAULT = "U08C40K4FHN";

export function cleanHandle(value: string, fallback = SLACK_HANDLE): string {
  const trimmed = value.trim().replace(/^@/, "");
  return NAME.test(trimmed) ? trimmed : fallback;
}

export function cleanNameList(values: string[], max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = value.trim().replace(/^[@#]/, "");
    if (!name || name.length > 80) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

function mentionPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.-])@${escaped}(?=$|[^\\w.-])`, "i");
}

function mentionsName(text: string, alias: string): boolean {
  const name = alias.trim().replace(/^@/, "");
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (name.includes(" ")) {
    return new RegExp(`(^|[^\\w.-])@?${escaped}(?=$|[^\\w.-])`, "i").test(text);
  }
  return mentionPattern(name).test(text);
}

/** True when the text mentions the handle or an alias (`@cursor`, `cursor bot`, `cursoragent`, …). */
export function slackMentioned(
  text: string,
  options: { handle: string; aliases: string[]; botUserId?: string | null },
): boolean {
  if (options.botUserId && text.includes(`<@${options.botUserId}>`)) return true;
  const names = [options.handle, ...options.aliases].map((name) => name.trim().replace(/^@/, "")).filter(Boolean);
  return names.some((name) => mentionsName(text, name));
}

export function githubRepoInScope(fullName: string): boolean {
  const owner = fullName.split("/")[0]?.trim() ?? "";
  if (!owner) return false;
  return GITHUB_REPO_OWNERS.some((allowed) => allowed.toLowerCase() === owner.toLowerCase());
}

export function githubMentionTargets(extra: string[] = []): string[] {
  return [...new Set([...GITHUB_MENTION_TARGETS, ...extra.map((target) => target.trim()).filter(Boolean)])];
}

/** True when a PR comment mentions avinitDollarpe, cursor, cursoragent, or another configured login. */
export function githubMentioned(body: string, targets: string[]): boolean {
  return targets.some((target) => {
    const name = target.trim().replace(/^@/, "").replace(/\[bot\]$/i, "");
    if (!name) return false;
    return mentionPattern(name).test(body) || mentionPattern(`${name}[bot]`).test(body);
  });
}

/** `*` or an empty allowlist means every channel. Other entries are channel ids or names. */
export function channelAllowed(allowlist: string[], channelId: string, channelName?: string | null): boolean {
  if (allowlist.length === 0 || allowlist.some((entry) => entry.trim() === "*")) return true;
  const id = channelId.trim().toLowerCase();
  const name = (channelName ?? "").trim().replace(/^#/, "").toLowerCase();
  return allowlist.some((entry) => {
    const value = entry.trim().replace(/^#/, "").toLowerCase();
    return value === id || (name !== "" && value === name);
  });
}
