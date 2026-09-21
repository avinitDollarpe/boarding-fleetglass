import { launchTask } from "@/server/fleet";
import { fleetResponse, readJson, requireBearer, str } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireBearer(request);
    const { id } = await context.params;
    const body = await readJson(request);
    const task = await launchTask(
      userId,
      id,
      { prompt: str(body.prompt) ?? "", repoUrl: str(body.repoUrl), startingRef: str(body.startingRef) },
      "gilfoyle",
    );
    return Response.json({ task });
  } catch (error) {
    return fleetResponse(error);
  }
}
