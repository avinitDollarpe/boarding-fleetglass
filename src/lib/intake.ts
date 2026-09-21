export const TRIGGERS = ["github_pr_mention", "slack_bot_mention", "chat_delegate"] as const;

export type Trigger = (typeof TRIGGERS)[number];

const TRIGGER_SET = new Set<string>(TRIGGERS);

export function isTrigger(value: string): value is Trigger {
  return TRIGGER_SET.has(value);
}

export type TriggerPayload = {
  repo?: string;
  prNumber?: number;
  prUrl?: string;
  commentBody?: string;
  commenter?: string;
  mentionTargets?: string[];
  commentId?: string;
  teamId?: string;
  channelId?: string;
  channel?: string;
  permalink?: string;
  text?: string;
  user?: string;
  messageTs?: string;
  slackTs?: string;
  context?: string;
  via?: string;
};

export type IntakeInput = {
  name?: string | null;
  trigger?: string | null;
  source?: string | null;
  sourceRef?: string | null;
  idempotencyKey?: string | null;
  commentId?: string | null;
  payload?: TriggerPayload | null;
  owner?: string | null;
};

export type NormalizedIntake = {
  trigger: Trigger;
  source: Trigger;
  sourceRef: string | null;
  idempotencyKey: string | null;
  name: string;
  owner: string;
  payload: TriggerPayload;
};

export function normalizeSourceRef(trigger: Trigger, ref: string | null): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trigger !== "github_pr_mention") return trimmed;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.origin.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return trimmed;
  }
}

function clip(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function normalizeIntake(
  input: IntakeInput,
): { ok: true; value: NormalizedIntake } | { ok: false; error: string } {
  const raw = (input.trigger || input.source || "").trim();
  if (!isTrigger(raw)) {
    return {
      ok: false,
      error: "trigger must be github_pr_mention, slack_bot_mention, or chat_delegate",
    };
  }
  const payload: TriggerPayload = { ...(input.payload ?? {}) };
  if (input.commentId && !payload.commentId) payload.commentId = input.commentId;

  const ref =
    input.sourceRef ||
    payload.prUrl ||
    payload.permalink ||
    null;
  const sourceRef = normalizeSourceRef(raw, ref);

  let idempotencyKey = input.idempotencyKey?.trim() || null;
  if (!idempotencyKey && raw === "github_pr_mention" && payload.commentId) {
    idempotencyKey = `github_comment:${payload.commentId}`;
  }
  const slackTs = payload.slackTs || payload.messageTs || null;
  if (slackTs && !payload.slackTs) payload.slackTs = slackTs;
  if (!idempotencyKey && raw === "slack_bot_mention" && slackTs) {
    idempotencyKey =
      payload.teamId && payload.channelId
        ? `slack:${payload.teamId}:${payload.channelId}:${slackTs}`
        : `slack_ts:${slackTs}`;
  }
  if (idempotencyKey) idempotencyKey = idempotencyKey.slice(0, 200);

  const excerpt = payload.commentBody || payload.text || payload.context || "";
  let name = input.name?.trim() || "";
  if (!name && raw === "github_pr_mention") {
    const where = payload.repo && payload.prNumber ? `${payload.repo}#${payload.prNumber}` : "pull request";
    name = excerpt ? clip(excerpt, 80) : `Mention on ${where}`;
  } else if (!name && raw === "slack_bot_mention") {
    name = excerpt ? clip(excerpt, 80) : "Slack mention";
  } else if (!name) {
    name = excerpt ? clip(excerpt, 80) : "Delegated task";
  }
  if (name.length > 200) name = clip(name, 200);

  return {
    ok: true,
    value: {
      trigger: raw,
      source: raw,
      sourceRef,
      idempotencyKey,
      name,
      owner: (input.owner ?? "").trim(),
      payload,
    },
  };
}

export type ExistingRef = { id: string; parentId: string | null };

/** Dedupe wins. A new GitHub comment on a PR that already has a parent task becomes a follow-up. */
export function decideIntake(
  value: NormalizedIntake,
  found: { byKey: ExistingRef | null; byPr: ExistingRef | null },
):
  | { action: "dedupe"; taskId: string }
  | { action: "follow_up"; parentId: string }
  | { action: "create" } {
  if (found.byKey) return { action: "dedupe", taskId: found.byKey.id };
  if (
    value.trigger === "github_pr_mention" &&
    value.sourceRef &&
    found.byPr &&
    !found.byPr.parentId
  ) {
    return { action: "follow_up", parentId: found.byPr.id };
  }
  return { action: "create" };
}
