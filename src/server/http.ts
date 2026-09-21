import { auth } from "@/auth";
import type { IntakeInput, TriggerPayload } from "@/lib/intake";
import { FleetError } from "@/server/fleet";
import { bearerUser } from "@/server/keys";

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function intakeFromBody(body: Record<string, unknown>): IntakeInput {
  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as TriggerPayload)
      : {};
  return {
    name: str(body.name),
    trigger: str(body.trigger),
    source: str(body.source),
    sourceRef: str(body.sourceRef) ?? str(body.source_ref),
    idempotencyKey: str(body.idempotencyKey) ?? str(body.idempotency_key),
    commentId: str(body.commentId) ?? str(body.comment_id),
    owner: str(body.owner),
    payload,
  };
}

export async function sessionUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireBearer(request: Request): Promise<string> {
  const userId = await bearerUser(request);
  if (!userId) throw new FleetError("Ingest key required", 401, "unauthorized");
  return userId;
}

export function fleetResponse(error: unknown): Response {
  if (error instanceof FleetError) {
    return Response.json({ error: error.code, message: error.message, ...error.extra }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "server_error", message: "Something went wrong" }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FleetError("JSON body required", 400, "invalid_json");
  }
  return body as Record<string, unknown>;
}
