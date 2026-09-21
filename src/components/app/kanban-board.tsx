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
import { GripVertical } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { moveTask } from "@/app/actions";
import { StateBadge, TriggerLabel } from "@/components/app/state-badge";
import { EASE_OUT } from "@/lib/ease";
import { formatTokens } from "@/lib/format";
import { STATES } from "@/lib/states";

export type BoardCard = {
  id: string;
  name: string;
  owner: string;
  state: string;
  trigger: string;
  tokens: number;
  subtasks: number;
  subtasksDone: number;
};

function initials(owner: string) {
  const parts = owner.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function CardBody({ task, handle }: { task: BoardCard; handle?: Record<string, unknown> }) {
  const progress = task.subtasks > 0 ? Math.round((task.subtasksDone / task.subtasks) * 100) : 0;
  return (
    <article className="rounded-[8px] bg-background p-3 shadow-[var(--shadow-border)]">
      <div className="flex items-start gap-2">
        <button type="button" className="press -ms-1 mt-0.5 flex size-11 shrink-0 items-center justify-center text-muted-foreground" aria-label={`Move ${task.name}`} {...handle}>
          <GripVertical className="size-4" strokeWidth={1.5} />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/tasks/${task.id}`} className="block font-medium leading-snug">
            {task.name}
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2">
            <TriggerLabel trigger={task.trigger} />
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium" title={task.owner || "Unassigned"}>
              {initials(task.owner)}
            </span>
          </div>
          {task.subtasks > 0 ? (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {task.subtasksDone}/{task.subtasks} subtasks
              </p>
            </div>
          ) : null}
          <p className="num mt-2 text-xs text-muted-foreground">{formatTokens(task.tokens)} tokens</p>
        </div>
      </div>
    </article>
  );
}

function TaskCard({ task }: { task: BoardCard }) {
  const sortable = useSortable({ id: task.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={sortable.isDragging ? "opacity-40" : undefined}
    >
      <CardBody task={task} handle={{ ...sortable.attributes, ...sortable.listeners }} />
    </div>
  );
}

function Column({ state, tasks }: { state: string; tasks: BoardCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  return (
    <section className={`column flex w-72 shrink-0 flex-col ${isOver ? "ring-2 ring-primary" : ""}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <StateBadge state={state} />
        <span className="num text-sm text-muted-foreground">{tasks.length}</span>
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? <p className="px-1 py-2 text-sm text-muted-foreground">Drop a task</p> : null}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

export function KanbanBoard({ cards }: { cards: BoardCard[] }) {
  const [items, setItems] = useState(cards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const active = items.find((task) => task.id === activeId) ?? null;

  function columnOf(id: string) {
    if ((STATES as readonly string[]).includes(id)) return id;
    return items.find((task) => task.id === id)?.state ?? null;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const taskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const from = items.find((task) => task.id === taskId)?.state;
    const to = columnOf(overId);
    if (!from || !to || from === to) return;
    const previous = items;
    setItems((current) => current.map((task) => (task.id === taskId ? { ...task, state: to } : task)));
    const result = await moveTask(taskId, to);
    if (!result.ok) {
      const landed = result.state;
      setItems(
        landed
          ? previous.map((task) => (task.id === taskId ? { ...task, state: landed } : task))
          : previous,
      );
      setNotice(result.message);
      return;
    }
    if (result.state !== to) {
      setItems((current) => current.map((task) => (task.id === taskId ? { ...task, state: result.state } : task)));
      setNotice(`Cursor plan gate moved this task to ${result.state}.`);
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
      >
        <div className="flex gap-4 overflow-x-auto pb-4 pe-8">
          {STATES.map((state) => (
            <Column key={state} state={state} tasks={items.filter((task) => task.state === state)} />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="w-72">
              <CardBody task={active} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <AnimatePresence initial={false}>
        {notice ? (
          <motion.div
            role="status"
            className="fixed bottom-4 end-4 z-40 max-w-sm rounded-[12px] bg-card p-3 text-sm shadow-[var(--shadow-border)]"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
          >
            <p>{notice}</p>
            <button type="button" className="press mt-2 text-sm text-muted-foreground" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
