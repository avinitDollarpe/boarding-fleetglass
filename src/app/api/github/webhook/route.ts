import { receiveGithubWebhook } from "@/server/listeners";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const result = await receiveGithubWebhook(
      raw,
      request.headers.get("x-hub-signature-256"),
      request.headers.get("x-github-event"),
    );
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
