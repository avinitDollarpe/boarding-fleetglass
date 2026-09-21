import { ingestUsage } from "@/server/fleet";
import { fleetResponse, readJson, requireBearer, str } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const taskId = str(body.taskId);
    if (!taskId) return Response.json({ error: "invalid_usage", message: "taskId is required" }, { status: 400 });
    const result = await ingestUsage(
      userId,
      {
        taskId,
        agentId: str(body.agentId),
        model: str(body.model) ?? "",
        inputTokens: Number(body.inputTokens ?? 0),
        outputTokens: Number(body.outputTokens ?? 0),
        cacheReadTokens: Number(body.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(body.cacheWriteTokens ?? 0),
        occurredAt: str(body.occurredAt),
        externalRef: str(body.externalRef),
        source: str(body.source) ?? "ingest",
      },
      "gilfoyle",
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return fleetResponse(error);
  }
}
