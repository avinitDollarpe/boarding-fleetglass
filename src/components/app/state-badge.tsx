const TONE: Record<string, string> = {
  Working: "text-primary",
  "Ready for review": "text-foreground",
  Blocked: "text-danger",
  "blocked:cursor_plan": "text-danger",
  Done: "text-success",
  Cancelled: "text-muted-foreground",
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex min-h-6 items-center rounded-[6px] bg-muted px-1.5 text-xs font-medium ${TONE[state] ?? "text-foreground"}`}>
      {state}
    </span>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  github_pr_mention: "GitHub mention",
  slack_bot_mention: "Slack mention",
  chat_delegate: "Chat delegate",
};

export function TriggerLabel({ trigger }: { trigger: string }) {
  return <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[trigger] ?? trigger}</span>;
}
