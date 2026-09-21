const PAID = new Set([
  "pro",
  "pro+",
  "pro_plus",
  "pro-plus",
  "ultra",
  "team",
  "teams",
  "business",
  "enterprise",
  "plus",
  "premium",
  "standard",
]);

const INACTIVE_STATUS = new Set([
  "canceled",
  "cancelled",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "inactive",
]);

export type PlanRead = {
  active: boolean;
  membership: string;
  status: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collect(value: unknown, into: Record<string, string>, depth = 0) {
  if (depth > 6) return;
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      if (!(key in into)) into[key] = String(child);
    } else {
      collect(child, into, depth + 1);
    }
  }
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isPaid(membership: string): boolean {
  const raw = membership.trim().toLowerCase();
  if (!raw) return false;
  if (/\bfree\b|\bhobby\b|\bunpaid\b|\bnone\b/.test(raw)) return false;
  const key = norm(raw);
  if (PAID.has(key) || PAID.has(raw)) return true;
  if (/\bpro\b|\bultra\b|\benterprise\b|\bbusiness\b|\bpremium\b/.test(raw)) return true;
  if (/\bteams?\b/.test(raw)) return true;
  return false;
}

/** Fail closed. An unreadable or free plan is not active. */
export function interpretPlan(body: unknown): PlanRead {
  const flat: Record<string, string> = {};
  collect(body, flat);
  const membership =
    flat.membershipType || flat.membership || flat.planName || flat.plan || flat.tier || "";
  const status = (flat.subscriptionStatus || flat.subscription_status || "").trim().toLowerCase();
  const inactive = INACTIVE_STATUS.has(status);
  const activeStatus = status === "" || status === "active" || status === "trialing";
  return {
    active: isPaid(membership) && activeStatus && !inactive,
    membership: membership.trim(),
    status,
  };
}

export function planOverride(): "active" | "inactive" | null {
  if (process.env.VERCEL) return null;
  if (process.env.ALLOW_PLAN_OVERRIDE !== "1") return null;
  const value = process.env.DEV_PLAN_OVERRIDE;
  if (value === "active" || value === "inactive") return value;
  return null;
}

export function cursorErrorIsPlan(status: number, body: string): boolean {
  if (status === 402) return true;
  return /plan|subscription|payment required|upgrade|billing/i.test(body);
}
