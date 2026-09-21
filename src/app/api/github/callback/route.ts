import { appOrigin, readState } from "@/server/oauth-state";
import { storeGithubInstall } from "@/server/installs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = readState(url.searchParams.get("state"));
  const installationId = url.searchParams.get("installation_id");
  const back = new URL("/settings/integrations", appOrigin());
  if (!userId || !installationId) {
    back.searchParams.set("github", "error");
    return Response.redirect(back);
  }
  await storeGithubInstall(userId, installationId);
  back.searchParams.set("github", "installed");
  return Response.redirect(back);
}
