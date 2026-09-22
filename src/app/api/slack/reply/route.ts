import { receiveSlackReply } from "@/server/listeners";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const result = await receiveSlackReply(raw);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
