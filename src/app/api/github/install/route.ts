import { auth } from "@/auth";
import { appOrigin, signState } from "@/server/oauth-state";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.redirect(new URL("/login", appOrigin()));
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return Response.redirect(new URL("/settings/integrations?github=unconfigured", appOrigin()));
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  url.searchParams.set("state", signState(session.user.id));
  return Response.redirect(url);
}
