import { createTask } from "@/server/fleet";
import { fleetResponse, intakeFromBody, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const created = await createTask(userId, {
      ...intakeFromBody(body),
      parentId: id,
      actor: "gilfoyle",
    });
    return Response.json(created, { status: created.deduped ? 200 : 201 });
  } catch (error) {
    return fleetResponse(error);
  }
}
