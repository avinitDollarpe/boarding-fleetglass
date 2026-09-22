import { stripSlackMentions } from "@/lib/slack-event";

export type ThreadWatch = {
  channelId: string;
  threadTs: string;
  refs: string[];
  ownerId: string;
  createdAt: string;
};

export type ThreadWatchAsk = {
  refs: string[];
};

export type SlackWatchBrief = {
  channel_id: string;
  thread_ts: string;
  refs: string[];
  owner_id: string;
  created_at: string;
  ack: string;
};

const WATCH_PHRASES: ReadonlySet<string> = new Set([
  "watch this thread",
  "watch the thread",
  "watch this",
  "keep this thread updated",
  "keep this thread up to date",
  "keep this updated",
  "keep me updated",
  "keep me updated on this thread",
  "follow this thread",
]);

const WORK_REF =
  /\bCE-(\d+)\b|https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)|\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/gi;

export function extractWorkRefs(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(new RegExp(WORK_REF.source, "gi"))) {
    const ref = match[1]
      ? `CE-${match[1]}`
      : match[2] && match[3] && match[4]
        ? `${match[2]}/${match[3]}#${match[4]}`
        : match[5] && match[6] && match[7]
          ? `${match[5]}/${match[6]}#${match[7]}`
          : "";
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function watchResidual(text: string): string {
  const stripped = stripSlackMentions(text)
    .replace(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/gi, " ")
    .replace(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+\b/g, " ")
    .replace(/\bce-\d+\b/gi, " ");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please|can you|could you)\s+/, "");
}

export function parseThreadWatchAsk(text: string): ThreadWatchAsk | null {
  const residual = watchResidual(text);
  const phrase = WATCH_PHRASES.has(residual) ? residual : residual.replace(/(?:\s+(?:and|for|please))+$/g, "").trim();
  if (!WATCH_PHRASES.has(phrase)) return null;
  return { refs: extractWorkRefs(stripSlackMentions(text)) };
}

export function threadWatchAck(refs: readonly string[]): string {
  if (refs.length === 0) return "Watching this thread. Updates land here on material change.";
  return `Watching this thread for ${refs.join(", ")}. Updates land here on material change.`;
}

export function toSlackWatchBrief(watch: ThreadWatch): SlackWatchBrief {
  return {
    channel_id: watch.channelId,
    thread_ts: watch.threadTs,
    refs: watch.refs,
    owner_id: watch.ownerId,
    created_at: watch.createdAt,
    ack: threadWatchAck(watch.refs),
  };
}
