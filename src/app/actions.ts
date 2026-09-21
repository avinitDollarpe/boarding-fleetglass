"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { createTask, ingestUsage, launchTask, transitionTask } from "@/server/fleet";
import { createIngestKey, replaceSlackAliases, revokeIngestKey } from "@/server/keys";
import { linkCursorKey } from "@/server/plan";
import { loadSampleFleet } from "@/server/sample";

async function userId() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/login?error=email");
  await signIn("nodemailer", { email, redirectTo: "/board" });
}

export async function linkCursor(formData: FormData) {
  const id = await userId();
  const plan = await linkCursorKey(id, String(formData.get("apiKey") ?? ""));
  redirect(plan.status === "active" ? "/board" : "/onboarding?checked=1");
}

export async function recheckPlan() {
  const id = await userId();
  const { verifyPlan } = await import("@/server/plan");
  const plan = await verifyPlan(id);
  redirect(plan.status === "active" ? "/board" : "/onboarding?checked=1");
}

export async function addTask(formData: FormData) {
  const id = await userId();
  await createTask(
    id,
    {
      name: String(formData.get("name") ?? ""),
      owner: String(formData.get("owner") ?? ""),
      trigger: "chat_delegate",
      payload: { via: "dashboard", context: String(formData.get("name") ?? "") },
      actor: "dashboard",
    },
    "dashboard",
  );
  revalidatePath("/board");
}

export async function loadSample() {
  const id = await userId();
  await loadSampleFleet(id);
  revalidatePath("/board");
  revalidatePath("/activity");
}

export async function changeState(formData: FormData) {
  const id = await userId();
  const taskId = String(formData.get("taskId") ?? "");
  await transitionTask(id, taskId, String(formData.get("state") ?? ""), null, "dashboard");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function launchAgent(formData: FormData) {
  const id = await userId();
  const taskId = String(formData.get("taskId") ?? "");
  try {
    await launchTask(
      id,
      taskId,
      {
        prompt: String(formData.get("prompt") ?? ""),
        repoUrl: String(formData.get("repoUrl") ?? "") || null,
        startingRef: String(formData.get("startingRef") ?? "") || null,
      },
      "dashboard",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    redirect(`/tasks/${taskId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/tasks/${taskId}`);
}

export async function recordUsage(formData: FormData) {
  const id = await userId();
  const taskId = String(formData.get("taskId") ?? "");
  await ingestUsage(
    id,
    {
      taskId,
      model: String(formData.get("model") ?? "composer-2"),
      inputTokens: Number(formData.get("inputTokens") ?? 0),
      outputTokens: Number(formData.get("outputTokens") ?? 0),
      agentId: String(formData.get("agentId") ?? "") || null,
      source: "manual",
    },
    "dashboard",
  );
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/activity");
}

export async function mintKey(formData: FormData) {
  const id = await userId();
  const created = await createIngestKey(id, String(formData.get("name") ?? "Gilfoyle"));
  redirect(`/settings?key=${encodeURIComponent(created.secret)}`);
}

export async function revokeKey(formData: FormData) {
  const id = await userId();
  await revokeIngestKey(id, String(formData.get("id") ?? ""));
  revalidatePath("/settings");
}

export async function saveAliases(formData: FormData) {
  const id = await userId();
  const aliases = String(formData.get("aliases") ?? "")
    .split(/[\n,]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  await replaceSlackAliases(id, aliases);
  revalidatePath("/settings");
}
