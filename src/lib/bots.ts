const NAME = /^@?([a-z0-9][a-z0-9._-]{0,79})$/i;

export function cleanHandle(value: string, fallback = "Fleetglass"): string {
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

/** True when the text mentions the Fleetglass handle or one of its aliases. @cursor is not implied. */
export function slackMentioned(
  text: string,
  options: { handle: string; aliases: string[]; botUserId?: string | null },
): boolean {
  if (options.botUserId && text.includes(`<@${options.botUserId}>`)) return true;
  const names = [options.handle, ...options.aliases].map((name) => name.trim().replace(/^@/, "")).filter(Boolean);
  return names.some((name) => mentionPattern(name).test(text));
}

/** True when a PR comment mentions a configured GitHub login or `login[bot]`. */
export function githubMentioned(body: string, targets: string[]): boolean {
  return targets.some((target) => {
    const name = target.trim().replace(/^@/, "").replace(/\[bot\]$/i, "");
    if (!name) return false;
    return mentionPattern(name).test(body) || mentionPattern(`${name}[bot]`).test(body);
  });
}

/** Empty allowlist means every channel. Entries are channel ids or names, without a leading #. */
export function channelAllowed(allowlist: string[], channelId: string, channelName?: string | null): boolean {
  if (allowlist.length === 0) return true;
  const id = channelId.trim().toLowerCase();
  const name = (channelName ?? "").trim().replace(/^#/, "").toLowerCase();
  return allowlist.some((entry) => {
    const value = entry.trim().replace(/^#/, "").toLowerCase();
    return value === id || (name !== "" && value === name);
  });
}
