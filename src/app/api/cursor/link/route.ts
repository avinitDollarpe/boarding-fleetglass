import { fleetResponse, readJson, sessionUser, str } from "@/server/http";
import { linkCursorKey } from "@/server/plan";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await sessionUser();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await readJson(request);
    const apiKey = str(body.apiKey);
    if (!apiKey) return Response.json({ error: "invalid_key" }, { status: 400 });
    return Response.json(await linkCursorKey(userId, apiKey));
  } catch (error) {
    return fleetResponse(error);
  }
}
