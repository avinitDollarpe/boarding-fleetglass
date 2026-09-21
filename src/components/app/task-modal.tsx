"use client";

import { useEffect, useRef, useState } from "react";
import { readTaskDetail } from "@/app/actions";
import { StateBadge, TriggerLabel } from "@/components/app/state-badge";
import { TaskPanels } from "@/components/app/task-panels";
import { formatTokens, formatUsdFromMicros } from "@/lib/format";

type Detail = NonNullable<Awaited<ReturnType<typeof readTaskDetail>>>;

export function TaskModal({
  taskId,
  onClose,
  onOpen,
}: {
  taskId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!taskId) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    let cancel = false;
    setDetail(null);
    readTaskDetail(taskId).then((row) => {
      if (!cancel) setDetail(row);
    });
    return () => {
      cancel = true;
    };
  }, [taskId]);

  const agentUrl = detail?.cloudAgentUrl || (detail?.bcId ? `https://cursor.com/agents/${detail.bcId}` : null);

  return (
    <dialog
      ref={ref}
      className="task-dialog"
      aria-label={detail?.name ?? "Task"}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium leading-snug">{detail?.name ?? "Loading"}</h2>
          {detail ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[oklch(0.78_0.01_90)]">
              <StateBadge state={detail.state} />
              <TriggerLabel trigger={detail.trigger} />
              <span>{detail.owner.trim() || "Unassigned"}</span>
              <span className="num text-[11px] text-[oklch(0.7_0.012_80)]">{detail.id.slice(0, 8)}</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[oklch(0.72_0.012_80)]">Loading</p>
          )}
          {detail ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {detail.sourceRef ? (
                <a href={detail.sourceRef} className="text-[oklch(0.82_0.08_200)]">
                  Source
                </a>
              ) : null}
              {detail.prUrl ? (
                <a href={detail.prUrl} className="text-[oklch(0.82_0.08_200)]">
                  Pull request
                </a>
              ) : null}
              {agentUrl ? (
                <a href={agentUrl} className="text-[oklch(0.82_0.08_200)]">
                  Agent
                </a>
              ) : null}
              {detail.repoUrl ? (
                <a href={detail.repoUrl} className="text-[oklch(0.82_0.08_200)]">
                  Repo
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <button type="button" className="press min-h-11 px-2 text-sm text-[oklch(0.75_0.01_80)]" onClick={onClose}>
          Close
        </button>
      </div>
      {detail ? (
        <div className="flex flex-col gap-5 px-5 pb-5">
          <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-white/10 py-3 text-sm">
            <div>
              <dt className="text-[11px] text-[oklch(0.7_0.012_80)]">Input</dt>
              <dd className="num">{formatTokens(detail.inputTokens)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[oklch(0.7_0.012_80)]">Output</dt>
              <dd className="num">{formatTokens(detail.outputTokens)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[oklch(0.7_0.012_80)]">Estimate</dt>
              <dd className="num">{formatUsdFromMicros(detail.costMicros)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[oklch(0.7_0.012_80)]">State</dt>
              <dd>{detail.state}</dd>
            </div>
          </dl>
          <TaskPanels events={detail.events} subtasks={detail.subtasks} usage={detail.usage} onSelect={onOpen} />
        </div>
      ) : null}
    </dialog>
  );
}
