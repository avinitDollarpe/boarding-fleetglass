import { listSlackAliases, replaceSlackAliases } from "@/server/keys";
import { fleetResponse, readJson, requireBearer } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireBearer(request);
    const slack = await listSlackAliases(userId);
    return Response.json({
      slack,
      builtIn: ["@cursor", "Cursor"],
      note: "Chief matches @cursor, the Cursor bot, or any alias in this list. Fleetglass stores the list; Chief owns the listener.",
    });
  } catch (error) {
    return fleetResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireBearer(request);
    const body = await readJson(request);
    const slack = Array.isArray(body.slack) ? body.slack.filter((item): item is string => typeof item === "string") : [];
    return Response.json({ slack: await replaceSlackAliases(userId, slack) });
  } catch (error) {
    return fleetResponse(error);
  }
}
