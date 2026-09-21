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
