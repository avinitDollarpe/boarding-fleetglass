import { taskStatus } from "@/server/fleet";
import { fleetResponse, requireBearer } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    return Response.json(await taskStatus(userId, id));
  } catch (error) {
    return fleetResponse(error);
  }
}
