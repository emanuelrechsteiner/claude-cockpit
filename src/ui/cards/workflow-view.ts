import type { TaskInfo, TaskStatus } from '../../types.js';

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
