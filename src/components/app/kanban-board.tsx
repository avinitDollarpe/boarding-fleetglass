"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, MoreHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { moveTask } from "@/app/actions";
import { TaskModal } from "@/components/app/task-modal";
import { EASE_OUT } from "@/lib/ease";
import {
  BOARD_COLUMNS,
  boardColumn,
  boardLabel,
  boardProgress,
  fleetHealth,
  fleetHealthLabel,
  isBoardColumn,
  stateForColumn,
  statesInColumn,
  type BoardColumnId,
  type FleetHealth,
} from "@/lib/states";

export type BoardCard = {
  id: string;
  name: string;
  owner: string;
  state: string;
  trigger: string;
  tokens: number;
  subtasks: number;
  subtasksDone: number;
  updatedAt: string;
};

const HEALTH_COLOR: Record<FleetHealth, string> = {
  on_track: "oklch(0.78 0.14 150)",
  at_risk: "oklch(0.82 0.14 85)",
  blocked: "oklch(0.68 0.18 25)",
  queued: "oklch(0.72 0.02 80)",
  cancelled: "oklch(0.62 0.01 80)",
};

const TRIGGER: Record<string, { label: string; className: string }> = {
  github_pr_mention: { label: "GitHub", className: "bg-[oklch(0.62_0.12_250/0.28)] text-[oklch(0.88_0.06_250)]" },
  slack_bot_mention: { label: "Slack", className: "bg-[oklch(0.58_0.12_320/0.3)] text-[oklch(0.9_0.05_320)]" },
  chat_delegate: { label: "Chat", className: "bg-[oklch(0.55_0.08_180/0.35)] text-[oklch(0.9_0.05_180)]" },
};

const COLUMN_ACCENT: Partial<Record<BoardColumnId, string>> = {
  IN_REVIEW: "review",
  BLOCKED: "blocked",
};

function initials(owner: string) {
  const parts = owner.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function whenLabel(iso: string, state: string) {
  if (state === "Holding" || state === "Blocked" || state === "blocked:cursor_plan") return "Waiting";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ProgressRing({ value, color }: { value: number; color: string }) {
  const radius = 8;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (Math.min(100, Math.max(0, value)) / 100) * circ;
  return (
    <span className="inline-flex items-center gap-1 text-[oklch(0.78_0.01_80)]">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={radius} fill="none" stroke="oklch(1 0 0 / 0.16)" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="num text-[11px]">{value}%</span>
    </span>
  );
}

function CardBody({
  task,
  handle,
  onOpen,
}: {
  task: BoardCard;
  handle?: Record<string, unknown>;
  onOpen?: (id: string) => void;
}) {
  const health = fleetHealth(task.state);
  const color = HEALTH_COLOR[health];
  const progress = boardProgress(task.state, task.subtasks, task.subtasksDone);
  const trigger = TRIGGER[task.trigger] ?? { label: task.trigger, className: "bg-white/10 text-white/80" };
  const owner = task.owner.trim() || "Unassigned";
  return (
    <article
      {...handle}
      aria-label={`Move ${task.name}`}
      className="board-card cursor-grab p-3 active:cursor-grabbing"
      onClick={() => onOpen?.(task.id)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${trigger.className}`}>
          {trigger.label}
        </span>
        <span className="num min-w-0 truncate text-[11px] text-[oklch(0.7_0.012_80)]">{task.id.slice(0, 8)}</span>
        <span className="ms-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] text-[oklch(0.9_0.01_95)]">
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          {fleetHealthLabel(health)}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-medium leading-snug text-white">{task.name}</h3>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-medium text-white" title={owner}>
          {initials(owner)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[oklch(0.78_0.01_90)]">{owner}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/25 px-1.5 py-0.5 text-[11px] text-[oklch(0.78_0.01_80)]">
          <Calendar className="size-3" strokeWidth={1.5} />
          {whenLabel(task.updatedAt, task.state)}
        </span>
        <ProgressRing value={progress} color={color} />
      </div>
    </article>
  );
}

function TaskCard({ task, onOpen }: { task: BoardCard; onOpen: (id: string) => void }) {
  const sortable = useSortable({ id: task.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={sortable.isDragging ? "opacity-40" : undefined}
    >
      <CardBody task={task} onOpen={onOpen} handle={{ ...sortable.attributes, ...sortable.listeners }} />
    </div>
  );
}

function ColumnMenu({ column }: { column: BoardColumnId }) {
  const [open, setOpen] = useState(false);
  const states = statesInColumn(column);
  return (
    <div className="relative">
      <button
        type="button"
        className="press flex size-8 items-center justify-center rounded-full text-[oklch(0.75_0.01_80)]"
        aria-label={`${boardLabel(column)} states`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-4" strokeWidth={1.5} />
      </button>
      {open ? (
        <div className="absolute end-0 z-10 mt-1 w-44 rounded-[8px] bg-[oklch(0.22_0.008_50)] p-2 text-[11px] text-[oklch(0.82_0.01_90)] shadow-[0_0_0_1px_oklch(1_0_0/0.1)]">
          {states.map((state) => (
            <p key={state} className="px-1 py-1">
              {state}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Column({
  index,
  column,
  tasks,
  onOpen,
}: {
  index: number;
  column: BoardColumnId;
  tasks: BoardCard[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <section data-accent={COLUMN_ACCENT[column]} className={`board-column flex w-[280px] shrink-0 flex-col ${isOver ? "ring-2 ring-white/40" : ""}`}>
      <header className="mb-2 flex items-center gap-2 px-1">
        <h2 className="text-sm font-medium text-white">
          {index}. {boardLabel(column)}
        </h2>
        <span className="num inline-flex min-w-5 items-center justify-center rounded-full bg-black/35 px-1.5 py-0.5 text-[11px] text-[oklch(0.8_0.01_90)]">
          {tasks.length}
        </span>
        <span className="ms-auto">
          <ColumnMenu column={column} />
        </span>
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? <p className="px-1 py-2 text-xs text-[oklch(0.65_0.01_80)]">Empty</p> : null}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpen} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

export function KanbanBoard({ cards }: { cards: BoardCard[] }) {
  const [items, setItems] = useState(cards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragged = useRef(false);
  const reduce = useReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const active = items.find((task) => task.id === activeId) ?? null;

  function columnOf(id: string): BoardColumnId | null {
    if (isBoardColumn(id)) return id;
    const task = items.find((item) => item.id === id);
    return task ? boardColumn(task.state) : null;
  }

  function onDragStart(event: DragStartEvent) {
    dragged.current = true;
    setActiveId(String(event.active.id));
  }

  function clearDrag() {
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    clearDrag();
    const taskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const task = items.find((item) => item.id === taskId);
    const from = task ? boardColumn(task.state) : null;
    const to = columnOf(overId);
    if (!from || !to || from === to) return;
    const next = stateForColumn(to);
    const previous = items;
    setItems((current) => current.map((item) => (item.id === taskId ? { ...item, state: next } : item)));
    const result = await moveTask(taskId, next);
    if (!result.ok) {
      const landed = result.state;
      setItems(
        landed
          ? previous.map((item) => (item.id === taskId ? { ...item, state: landed } : item))
          : previous,
      );
      setNotice(result.message);
      return;
    }
    if (boardColumn(result.state) !== to) {
      setItems((current) => current.map((item) => (item.id === taskId ? { ...item, state: result.state } : item)));
      setNotice(`Plan gate moved this task to ${boardLabel(result.state)}.`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const hits = pointerWithin(args);
          return hits.length > 0 ? hits : closestCorners(args);
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          clearDrag();
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((column, index) => (
            <Column
              key={column.id}
              index={index + 1}
              column={column.id}
              tasks={items.filter((task) => boardColumn(task.state) === column.id)}
              onOpen={(id) => {
                if (dragged.current) return;
                setOpenId(id);
              }}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="w-[280px]">
              <CardBody task={active} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <TaskModal taskId={openId} onOpen={setOpenId} onClose={() => setOpenId(null)} />
      <AnimatePresence initial={false}>
        {notice ? (
          <motion.div
            role="status"
            className="fixed bottom-4 end-4 z-40 max-w-sm rounded-[12px] bg-[oklch(0.22_0.008_50)] p-3 text-sm text-white shadow-[0_0_0_1px_oklch(1_0_0/0.1)]"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
          >
            <p>{notice}</p>
            <button type="button" className="press mt-2 text-sm text-[oklch(0.75_0.01_80)]" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
