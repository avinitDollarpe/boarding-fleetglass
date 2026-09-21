export type Trigger = "github_pr_mention" | "slack_bot_mention" | "chat_delegate";

export type IngestTask = {
  name?: string;
  trigger?: Trigger;
  source?: Trigger;
  sourceRef?: string;
  idempotencyKey?: string;
  commentId?: string;
  owner?: string;
  repoUrl?: string;
  prs?: string;
  payload?: Record<string, unknown>;
  subtasks?: IngestTask[];
};

export function createFleetglassClient(options: { baseUrl: string; apiKey: string }) {
  async function call(path: string, init?: RequestInit) {
    const response = await fetch(new URL(path, options.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof body.message === "string" ? body.message : `Fleetglass ${response.status}`);
    }
    return body;
  }

  return {
    plan: () => call("/api/v1/plan"),
    aliases: () => call("/api/v1/aliases"),
    integrations: () => call("/api/v1/integrations"),
    createTask: (task: IngestTask) => call("/api/v1/tasks", { method: "POST", body: JSON.stringify(task) }),
    transition: (taskId: string, state: string, note?: string) =>
      call(`/api/v1/tasks/${taskId}/transition`, { method: "POST", body: JSON.stringify({ state, note }) }),
    launch: (taskId: string, input: { prompt: string; repoUrl?: string; startingRef?: string }) =>
      call(`/api/v1/tasks/${taskId}/launch`, { method: "POST", body: JSON.stringify(input) }),
    usage: (input: { taskId: string; agentId?: string; model: string; inputTokens: number; outputTokens: number; occurredAt?: string }) =>
      call("/api/v1/usage", { method: "POST", body: JSON.stringify(input) }),
    agentStatus: (input: { taskId?: string; idempotencyKey?: string; state?: string; bcId?: string; prUrl?: string; note?: string }) =>
      call("/api/v1/agent-status", { method: "POST", body: JSON.stringify(input) }),
    status: (taskId: string) => call(`/api/v1/tasks/${taskId}/status`),
  };
}
