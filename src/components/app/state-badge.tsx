import { boardColumn, boardLabel } from "@/lib/states";

const TONE: Record<string, string> = {
  PENDING: "text-muted-foreground",
  IN_PROGRESS: "text-primary",
  IN_REVIEW: "text-foreground",
  BLOCKED: "text-danger",
  DONE: "text-success",
  CANCELLED: "text-muted-foreground",
};

export function StateBadge({ state }: { state: string }) {
  const column = boardColumn(state);
  const plan = state === "blocked:cursor_plan";
  return (
    <span className={`inline-flex min-h-6 items-center rounded-[6px] bg-muted px-1.5 text-xs font-medium ${TONE[column] ?? "text-foreground"}`} title={state}>
      {boardLabel(state)}
      {plan ? <span className="ms-1 font-normal text-muted-foreground">plan</span> : null}
    </span>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  github_pr_mention: "GitHub",
  slack_bot_mention: "Slack",
  chat_delegate: "Chat",
};

export function TriggerLabel({ trigger }: { trigger: string }) {
  return <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[trigger] ?? trigger}</span>;
}
