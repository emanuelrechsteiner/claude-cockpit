import type { TaskInfo, TaskStatus, WorkflowInfo } from '../../types.js';

export const TASK_BAR_WIDTH = 6;
const RUNNING_BLOCK = 2;
/** The dashboard redraws every 2 s; the running block moves one cell per redraw. */
const STEP_MS = 2000;

/**
 * The small bar behind one task. A task reports a state, not a percentage,
 * so the bar never pretends to measure: full when completed, empty when
 * pending, and a two-cell block travelling across it while the task runs.
 */
export function taskBar(status: TaskStatus, now: number): string {
  if (status === 'completed') return '█'.repeat(TASK_BAR_WIDTH);
  if (status === 'pending') return '░'.repeat(TASK_BAR_WIDTH);
  const positions = TASK_BAR_WIDTH - RUNNING_BLOCK + 1;
  const at = Math.floor(now / STEP_MS) % positions;
  return '░'.repeat(at) + '█'.repeat(RUNNING_BLOCK) + '░'.repeat(TASK_BAR_WIDTH - RUNNING_BLOCK - at);
}

/**
 * The window of tasks that fits the card: everything if it fits, otherwise
 * starting one task before the first unfinished one, so the last completed
 * task, the running one and what comes next stay in view.
 */
export function visibleTasks(tasks: TaskInfo[], max: number): { shown: TaskInfo[]; hidden: number } {
  if (tasks.length <= max) return { shown: tasks, hidden: 0 };
  const firstOpen = tasks.findIndex((t) => t.status !== 'completed');
  const anchor = firstOpen === -1 ? tasks.length - max : Math.max(0, firstOpen - 1);
  const start = Math.min(anchor, tasks.length - max);
  return { shown: tasks.slice(start, start + max), hidden: tasks.length - max };
}

/** One rendered block of Card 4: a workflow's overall bar plus its visible task rows. */
export interface WorkflowBlock {
  name: string;
  done: number;
  total: number;
  /** Cursor row of this block's overall bar. */
  barRow: number;
  /** Cursor row of each visible task, paired with the task it belongs to. */
  taskRows: { row: number; task: TaskInfo }[];
  hidden: number;
}

/**
 * Row layout for Card 4, computed without any UI framework so it can be unit
 * tested directly: one block per non-empty workflow, in the given order,
 * with the keyboard cursor numbered CONTINUOUSLY across all blocks (this
 * block's bar, then its visible tasks, then the next block's bar, …). A
 * per-block reset would put two different rows at cursor 0 whenever more
 * than one workflow is shown at once (Tasks + Welle).
 */
export function workflowBlocks(workflows: WorkflowInfo[], maxTasks: number): WorkflowBlock[] {
  let row = 0;
  const blocks: WorkflowBlock[] = [];
  for (const w of workflows) {
    if (w.total === 0) continue;
    const { shown, hidden } = visibleTasks(w.tasks, maxTasks);
    const barRow = row;
    row += 1;
    const taskRows = shown.map((task) => ({ row: row++, task }));
    blocks.push({ name: w.name, done: w.done, total: w.total, barRow, taskRows, hidden });
  }
  return blocks;
}
