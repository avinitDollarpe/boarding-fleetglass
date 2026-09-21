import { cursorErrorIsPlan, interpretPlan, type PlanRead } from "@/lib/plan";

const CURSOR_API = "https://api.cursor.com";

export type CursorMe = {
  apiKeyName?: string;
  userId?: number;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
};

export type CursorAgent = {
  id: string;
  url?: string;
  name?: string;
  status?: string;
  latestRunId?: string;
  prUrl?: string;
};

function basic(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function cursorFetch(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CURSOR_API}${path}`, {
    ...init,
    headers: {
      Authorization: basic(apiKey),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(20000),
  });
}

export async function fetchCursorMe(apiKey: string): Promise<{ ok: true; me: CursorMe } | { ok: false; status: number }> {
  const res = await cursorFetch(apiKey, "/v1/me");
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, me: (await res.json()) as CursorMe };
}

/**
 * Cursor's Cloud Agents API identifies a key but does not return subscription status.
 * GetPlanInfo is the account plan read. Anything we cannot prove active fails closed.
 */
export async function fetchCursorPlan(apiKey: string): Promise<{
  active: boolean;
  reason: string;
  email: string | null;
  cursorUserId: string | null;
  read: PlanRead;
  raw: Record<string, unknown>;
}> {
  const me = await fetchCursorMe(apiKey);
  if (!me.ok) {
    return {
      active: false,
      reason: "cursor_auth_failed",
      email: null,
      cursorUserId: null,
      read: { active: false, membership: "", status: "" },
      raw: { meStatus: me.status },
    };
  }

  let planStatus = 0;
  let planBody: unknown = null;
  try {
    const res = await fetch("https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(20000),
    });
    planStatus = res.status;
    const text = await res.text();
    try {
      planBody = text ? JSON.parse(text) : null;
    } catch {
      planBody = { unparsed: text.slice(0, 500) };
    }
  } catch (error) {
    planBody = { error: error instanceof Error ? error.message : "plan probe failed" };
  }

  const read = interpretPlan(planBody);
  const proved = planStatus >= 200 && planStatus < 300 && read.active;
  return {
    active: proved,
    reason: proved ? "active" : planStatus >= 200 && planStatus < 300 ? "cursor_plan_inactive" : "plan_unreadable",
    email: me.me.userEmail ?? null,
    cursorUserId: me.me.userId != null ? String(me.me.userId) : null,
    read,
    raw: { me: me.me, planStatus, plan: planBody },
  };
}

export async function launchCursorAgent(
  apiKey: string,
  input: { name: string; prompt: string; repoUrl?: string | null; startingRef?: string | null },
): Promise<
  | { ok: true; agent: CursorAgent }
  | { ok: false; status: number; body: string; planBlocked: boolean }
> {
  const payload: Record<string, unknown> = {
    name: input.name.slice(0, 100),
    prompt: { text: input.prompt },
    autoCreatePR: true,
  };
  if (input.repoUrl) {
    payload.repos = [{ url: input.repoUrl, startingRef: input.startingRef || "main" }];
  }
  const res = await cursorFetch(apiKey, "/v1/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body, planBlocked: cursorErrorIsPlan(res.status, body) };
  }
  const parsed = JSON.parse(body) as { agent?: CursorAgent };
  if (!parsed.agent?.id) {
    return { ok: false, status: 502, body: "Cursor did not return an agent id", planBlocked: false };
  }
  return { ok: true, agent: parsed.agent };
}

export type RunUsage = {
  id: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
};

export async function fetchAgentUsage(
  apiKey: string,
  agentId: string,
): Promise<{ ok: true; runs: RunUsage[] } | { ok: false; status: number }> {
  const res = await cursorFetch(apiKey, `/v1/agents/${encodeURIComponent(agentId)}/usage`);
  if (!res.ok) return { ok: false, status: res.status };
  const parsed = (await res.json()) as { runs?: RunUsage[] };
  return { ok: true, runs: parsed.runs ?? [] };
}
