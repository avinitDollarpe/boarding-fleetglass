import { fleetResponse, requireBearer } from "@/server/http";
import { verifyPlan } from "@/server/plan";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const plan = await verifyPlan(userId);
    return Response.json({
      active: plan.status === "active",
      status: plan.status,
      reason: plan.reason,
      email: plan.email,
      checkedAt: plan.checkedAt,
    });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
