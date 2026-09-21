import { transitionTask } from "@/server/fleet";
import { fleetResponse, readJson, requireBearer, str } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const state = str(body.state);
    if (!state) return Response.json({ error: "invalid_state" }, { status: 400 });
    const task = await transitionTask(userId, id, state, str(body.note), "gilfoyle");
    return Response.json({ task });
  } catch (error) {
    return fleetResponse(error);
  }
}
