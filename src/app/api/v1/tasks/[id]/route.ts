import { deleteTask, getTask, updateTask } from "@/server/fleet";
import { fleetResponse, readJson, requireBearer, str } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    const task = await getTask(userId, id);
    if (!task) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(task);
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const task = await updateTask(userId, id, {
      name: str(body.name) ?? undefined,
      owner: str(body.owner) ?? undefined,
      prs: body.prs === null ? null : str(body.prs) ?? undefined,
      prUrl: body.prUrl === null ? null : str(body.prUrl) ?? undefined,
      lastCommit: body.lastCommit === null ? null : str(body.lastCommit) ?? undefined,
      repoUrl: body.repoUrl === null ? null : str(body.repoUrl) ?? undefined,
      bcId: body.bcId === null ? null : str(body.bcId) ?? undefined,
      cloudAgentUrl: body.cloudAgentUrl === null ? null : str(body.cloudAgentUrl) ?? undefined,
    });
    return Response.json({ task });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    await deleteTask(userId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return fleetResponse(error);
  }
}
