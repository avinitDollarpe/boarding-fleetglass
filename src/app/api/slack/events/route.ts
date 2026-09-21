import { receiveSlackEvent } from "@/server/listeners";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const result = await receiveSlackEvent(
      raw,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
    );
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
