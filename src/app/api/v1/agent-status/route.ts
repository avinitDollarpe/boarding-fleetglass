import { agentStatus } from "@/server/fleet";
import { fleetResponse, readJson, requireBearer, str } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const task = await agentStatus(
      userId,
      {
        taskId: str(body.taskId) ?? undefined,
        idempotencyKey: str(body.idempotencyKey) ?? undefined,
        state: str(body.state) ?? undefined,
        bcId: str(body.bcId),
        prUrl: str(body.prUrl),
        cloudAgentUrl: str(body.cloudAgentUrl),
        lastCommit: str(body.lastCommit),
        note: str(body.note),
      },
      "gilfoyle",
    );
    return Response.json({ task });
  } catch (error) {
    return fleetResponse(error);
  }
}
