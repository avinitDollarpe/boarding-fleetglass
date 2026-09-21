import { createTask, listTasks } from "@/server/fleet";
import { fleetResponse, intakeFromBody, readJson, requireBearer, str } from "@/server/http";
import type { IntakeInput } from "@/lib/intake";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const tasks = await listTasks(userId);
    const sourceRef = new URL(request.url).searchParams.get("sourceRef");
    const filtered = sourceRef ? tasks.filter((task) => task.sourceRef === sourceRef && !task.parentId) : tasks;
    return Response.json({ tasks: filtered });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const subtasks = Array.isArray(body.subtasks)
      ? body.subtasks.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)).map(intakeFromBody)
      : [];
    const created = await createTask(userId, {
      ...intakeFromBody(body),
      externalId: str(body.externalId),
      prs: str(body.prs),
      repoUrl: str(body.repoUrl),
      subtasks: subtasks as IntakeInput[],
      actor: "gilfoyle",
    });
    return Response.json(created, { status: created.deduped ? 200 : 201 });
  } catch (error) {
    return fleetResponse(error);
  }
}
