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
import { Calendar, Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { moveTask } from "@/app/actions";
import { TaskModal } from "@/components/app/task-modal";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { EASE_OUT } from "@/lib/ease";
import { BOARD_COLUMNS, boardColumn, boardLabel, isBoardColumn, stateForColumn, type BoardColumnId } from "@/lib/states";

export type BoardCard = {
  id: string;
  name: string;
  description: string | null;
  owner: string;
  state: string;
  trigger: string;
  tokens: number;
  subtasks: number;
  subtasksDone: number;
  updatedAt: string;
};

const TRIGGERS = [
  { id: "github_pr_mention", label: "GitHub" },
  { id: "slack_bot_mention", label: "Slack" },
  { id: "chat_delegate", label: "Chat" },
] as const;

function initials(owner: string) {
  const parts = owner.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function dateLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ProgressRing({ value }: { value: number }) {
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
          stroke="oklch(0.78 0.1 150)"
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
  const owner = task.owner.trim();
  const mark = initials(owner);
  const progress = task.subtasks > 0 ? Math.round((task.subtasksDone / task.subtasks) * 100) : null;
  const when = dateLabel(task.updatedAt);
  return (
    <article
      {...handle}
      data-slot="kanban-card"
      aria-label={`Move ${task.name}`}
      className="board-card cursor-pointer p-3"
      onClick={() => onOpen?.(task.id)}
    >
      <h3 className="text-sm font-medium leading-snug text-white">{task.name}</h3>
      {task.description ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[oklch(0.72_0.012_80)]">{task.description}</p> : null}
      {mark || progress !== null ? (
        <div className="mt-3 flex items-center gap-2">
          {mark ? (
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-medium text-white" title={owner}>
              {mark}
            </span>
          ) : null}
          {progress !== null ? (
            <span className="ms-auto">
              <ProgressRing value={progress} />
            </span>
          ) : null}
        </div>
      ) : null}
      <hr className="my-3 border-0 border-t border-white/10" />
      {when ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-[oklch(0.78_0.01_80)]">
          <Calendar className="size-3" strokeWidth={1.5} />
          {when}
        </span>
      ) : null}
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

function Column({ column, tasks, onOpen }: { column: BoardColumnId; tasks: BoardCard[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <section data-slot="kanban-column" className={`board-column flex shrink-0 flex-col ${isOver ? "ring-2 ring-white/40" : ""}`}>
      <header className="mb-2 flex items-center gap-2 px-1">
        <h2 className="text-sm font-medium text-white">{boardLabel(column)}</h2>
        <span className="num inline-flex min-w-5 items-center justify-center rounded-full bg-black/35 px-1.5 py-0.5 text-[11px] text-[oklch(0.8_0.01_90)]">
          {tasks.length}
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

function TaskLine({ task, onOpen }: { task: BoardCard; onOpen: (id: string) => void }) {
  const when = dateLabel(task.updatedAt);
  return (
    <button type="button" className="flex w-full cursor-pointer items-center gap-3 border-b border-white/10 py-3 text-start" onClick={() => onOpen(task.id)}>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{task.name}</span>
      <span className="shrink-0 text-xs text-[oklch(0.72_0.012_80)]">{boardLabel(task.state)}</span>
      {task.owner.trim() ? <span className="hidden shrink-0 text-xs text-[oklch(0.72_0.012_80)] sm:inline">{task.owner}</span> : null}
      {when ? <span className="num shrink-0 text-xs text-[oklch(0.72_0.012_80)]">{when}</span> : null}
    </button>
  );
}

export function KanbanBoard({ cards }: { cards: BoardCard[] }) {
  const [items, setItems] = useState(cards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState("board");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [trigger, setTrigger] = useState<string | null>(null);
  const dragged = useRef(false);
  const reduce = useReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const active = items.find((task) => task.id === activeId) ?? null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((task) => {
      if (trigger && task.trigger !== trigger) return false;
      if (!q) return true;
      return task.name.toLowerCase().includes(q) || (task.description ?? "").toLowerCase().includes(q);
    });
  }, [items, query, trigger]);

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

  function onOpen(id: string) {
    if (dragged.current) return;
    setOpenId(id);
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={setView} variant="segment">
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[oklch(0.72_0.012_80)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="field h-11 w-56 ps-9"
            />
          </label>
          <button
            type="button"
            className="press btn btn-quiet"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
          </button>
        </div>
      </div>
      {filtersOpen ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Trigger">
          <button type="button" className={`press btn ${trigger === null ? "btn-primary" : "btn-quiet"}`} onClick={() => setTrigger(null)}>
            All
          </button>
          {TRIGGERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`press btn ${trigger === item.id ? "btn-primary" : "btn-quiet"}`}
              onClick={() => setTrigger(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {view === "board" ? (
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
          <div data-slot="kanban-board" className="flex gap-3 overflow-x-auto pb-2">
            {BOARD_COLUMNS.map((column) => (
              <Column
                key={column.id}
                column={column.id}
                tasks={visible.filter((task) => boardColumn(task.state) === column.id)}
                onOpen={onOpen}
              />
            ))}
          </div>
          <DragOverlay>
            {active ? (
              <div className="w-[340px]">
                <CardBody task={active} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}
      {view === "list" ? (
        <div>
          {visible.length === 0 ? <p className="text-sm text-[oklch(0.72_0.012_80)]">No tasks match.</p> : null}
          {visible.map((task) => (
            <TaskLine key={task.id} task={task} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[oklch(0.72_0.012_80)]">
              <tr>
                <th className="py-2 text-start font-medium">Task</th>
                <th className="py-2 text-start font-medium">Column</th>
                <th className="py-2 text-start font-medium">Owner</th>
                <th className="py-2 text-start font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <tr key={task.id} className="cursor-pointer border-t border-white/10" onClick={() => onOpen(task.id)}>
                  <td className="py-3 pe-4 font-medium text-white">{task.name}</td>
                  <td className="py-3 pe-4">{boardLabel(task.state)}</td>
                  <td className="py-3 pe-4">{task.owner.trim() || "—"}</td>
                  <td className="num py-3">{dateLabel(task.updatedAt) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? <p className="py-3 text-sm text-[oklch(0.72_0.012_80)]">No tasks match.</p> : null}
        </div>
      ) : null}
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
