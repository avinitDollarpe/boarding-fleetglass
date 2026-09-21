const TONE: Record<string, string> = {
  Working: "bg-[oklch(0.72_0.12_250)] text-[oklch(0.16_0.03_250)]",
  "Watching 1/3": "bg-[oklch(0.84_0.12_95)] text-[oklch(0.22_0.04_80)]",
  "Watching 2/3": "bg-[oklch(0.78_0.13_70)] text-[oklch(0.2_0.04_60)]",
  "Watching 3/3": "bg-[oklch(0.72_0.15_45)] text-[oklch(0.18_0.04_40)]",
  "Ready for review": "bg-[oklch(0.82_0.12_170)] text-[oklch(0.16_0.03_180)]",
  Holding: "bg-muted text-foreground",
  Blocked: "bg-[oklch(0.68_0.16_25)] text-white",
  "blocked:cursor_plan": "bg-[oklch(0.62_0.2_25)] text-white",
  Done: "bg-[oklch(0.78_0.12_150)] text-[oklch(0.16_0.03_150)]",
  Cancelled: "bg-muted text-muted-foreground",
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex min-h-6 items-center rounded-[8px] px-2 text-xs font-medium ${TONE[state] ?? "bg-muted"}`}>
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
