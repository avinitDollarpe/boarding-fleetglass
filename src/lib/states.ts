export const STATES = [
  "Working",
  "Watching 1/3",
  "Watching 2/3",
  "Watching 3/3",
  "Ready for review",
  "Holding",
  "Blocked",
  "blocked:cursor_plan",
  "Done",
  "Cancelled",
] as const;

export type TaskState = (typeof STATES)[number];

export const PLAN_BLOCKED: TaskState = "blocked:cursor_plan";

const STATE_SET = new Set<string>(STATES);

export function isTaskState(value: string): value is TaskState {
  return STATE_SET.has(value);
}

export function isTerminal(state: TaskState): boolean {
  return state === "Done" || state === "Cancelled";
}

/** Board columns. Stored task states stay in `STATES`; the kanban groups them. */
export const BOARD_COLUMNS = [
  { id: "PENDING", label: "Pending", state: "Holding" },
  { id: "IN_PROGRESS", label: "In progress", state: "Working" },
  { id: "IN_REVIEW", label: "In review", state: "Ready for review" },
  { id: "BLOCKED", label: "Blocked", state: "Blocked" },
  { id: "DONE", label: "Done", state: "Done" },
  { id: "CANCELLED", label: "Cancelled", state: "Cancelled" },
] as const;

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((column) => column.id));

const COLUMN_FOR_STATE: Record<TaskState, BoardColumnId> = {
  Holding: "PENDING",
  Working: "IN_PROGRESS",
  "Watching 1/3": "IN_PROGRESS",
  "Watching 2/3": "IN_PROGRESS",
  "Watching 3/3": "IN_PROGRESS",
  "Ready for review": "IN_REVIEW",
  Blocked: "BLOCKED",
  "blocked:cursor_plan": "BLOCKED",
  Done: "DONE",
  Cancelled: "CANCELLED",
};

export function isBoardColumn(value: string): value is BoardColumnId {
  return COLUMN_IDS.has(value);
}

export function boardColumn(state: string): BoardColumnId {
  if (isBoardColumn(state)) return state;
  if (isTaskState(state)) return COLUMN_FOR_STATE[state];
  return "PENDING";
}

export function boardLabel(state: string): string {
  const id = boardColumn(state);
  return BOARD_COLUMNS.find((column) => column.id === id)?.label ?? id;
}

/** Canonical stored state when a card is dropped on a board column. */
export function stateForColumn(column: BoardColumnId): TaskState {
  const match = BOARD_COLUMNS.find((item) => item.id === column);
  if (!match) return "Holding";
  return match.state;
}
