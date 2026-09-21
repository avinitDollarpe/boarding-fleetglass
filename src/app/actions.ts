"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, ownerMaySignIn, signIn } from "@/auth";
import { FleetError, getTask, ingestUsage, launchTask, transitionTask } from "@/server/fleet";
import { boardColumn, isBoardColumn, stateForColumn } from "@/lib/states";
import { linkCursorKey } from "@/server/plan";

async function userId() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/login?error=email");
  if (!ownerMaySignIn(email)) redirect("/login?error=owner");
  await signIn("nodemailer", { email, redirect: false, redirectTo: "/board" });
  redirect("/login/check-email");
}

export async function linkCursor(formData: FormData) {
  const id = await userId();
  const plan = await linkCursorKey(id, String(formData.get("apiKey") ?? ""));
  redirect(plan.status === "active" ? "/board" : "/board?checked=1");
}

export async function recheckPlan() {
  const id = await userId();
  const { verifyPlan } = await import("@/server/plan");
  const plan = await verifyPlan(id);
  redirect(plan.status === "active" ? "/board" : "/board?checked=1");
}

export async function moveTask(taskId: string, state: string) {
  const id = await userId();
  try {
    const task = await transitionTask(id, taskId, state, null, "dashboard");
    revalidatePath("/board");
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true as const, state: task.state };
  } catch (error) {
    revalidatePath("/board");
    revalidatePath(`/tasks/${taskId}`);
    if (error instanceof FleetError) {
      const landed = typeof error.extra?.state === "string" ? error.extra.state : null;
      return { ok: false as const, message: error.message, state: landed };
    }
    throw error;
  }
}

export async function changeState(formData: FormData) {
  const id = await userId();
  const taskId = String(formData.get("taskId") ?? "");
  const column = String(formData.get("column") ?? "");
  if (!isBoardColumn(column)) return;
  const current = await getTask(id, taskId);
  if (!current || boardColumn(current.task.state) === column) return;
  await transitionTask(id, taskId, stateForColumn(column), null, "dashboard");
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

