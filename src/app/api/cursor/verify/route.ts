import { fleetResponse, sessionUser } from "@/server/http";
import { verifyPlan } from "@/server/plan";

export const runtime = "nodejs";

export async function POST() {
  try {
    const userId = await sessionUser();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(await verifyPlan(userId));
  } catch (error) {
    return fleetResponse(error);
  }
}
