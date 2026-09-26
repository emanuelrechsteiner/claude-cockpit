import { describe, it, expect } from 'vitest';
import { reduceEvents, emptyEventState } from '../src/parse/events.js';
import { taskBar, visibleTasks } from '../src/ui/cards/workflow-view.js';
import type { TaskInfo } from '../src/types.js';

/** Real hook payload shapes, copied from a captured events-<sid>.jsonl. */
function created(ts: number, id: string, subject: string): string {
  return JSON.stringify({
    ts,
    event: 'TaskCreated',
    data: { tool_input: { subject, activeForm: subject }, tool_response: { task: { id, subject } } },
  });
}

function updated(ts: number, taskId: string, status: string): string {
  return JSON.stringify({
    ts,
    event: 'TaskUpdated',
    data: { tool_input: { taskId, status }, tool_response: { success: true, taskId } },
  });
}

describe('workflow tasks', () => {
  it('lists every task with its own status, in creation order', () => {
    const s = reduceEvents(
      [created(1, '1', 'Plan'), created(2, '2', 'Backend'), created(3, '3', 'Tests'), updated(4, '1', 'completed'), updated(5, '2', 'in_progress')],
      emptyEventState(),
    );
    expect(s.workflows[0].tasks.map((t) => [t.id, t.subject, t.status])).toEqual([
      ['1', 'Plan', 'completed'],
      ['2', 'Backend', 'in_progress'],
      ['3', 'Tests', 'pending'],
    ]);
    expect(s.workflows[0]).toMatchObject({ done: 1, total: 3 });
  });

  it('counts a task completed twice only once (regression: the old counter added 1 per update)', () => {
    const s = reduceEvents([created(1, '1', 'Plan'), updated(2, '1', 'completed'), updated(3, '1', 'completed')], emptyEventState());
    expect(s.workflows[0]).toMatchObject({ done: 1, total: 1 });
  });

  it('drops a deleted task from the list and the total', () => {
    const s = reduceEvents([created(1, '1', 'Plan'), created(2, '2', 'Obsolete'), updated(3, '2', 'deleted')], emptyEventState());
    expect(s.workflows[0].tasks.map((t) => t.id)).toEqual(['1']);
    expect(s.workflows[0].total).toBe(1);
  });

  it('keeps state across incremental reduce calls (the collector feeds new lines only)', () => {
    const first = reduceEvents([created(1, '1', 'Plan'), created(2, '2', 'Build')], emptyEventState());
    const second = reduceEvents([updated(3, '1', 'completed')], first);
    expect(second.workflows[0].tasks.map((t) => t.status)).toEqual(['completed', 'pending']);
    expect(first.workflows[0].tasks[0].status).toBe('pending');
  });
});

describe('taskBar', () => {
  it('is full for a completed task and empty for a pending one', () => {
    expect(taskBar('completed', 0)).toBe('██████');
    expect(taskBar('pending', 0)).toBe('░░░░░░');
  });

  it('shows a running task as a two-cell block that moves with the clock, never as a percentage', () => {
    const frames = [0, 2000, 4000, 6000, 8000, 10000].map((t) => taskBar('in_progress', t));
    for (const f of frames) {
      expect(f).toHaveLength(6);
      expect(f.split('█').length - 1).toBe(2);
    }
    expect(new Set(frames).size).toBeGreaterThan(1);
  });
});

describe('visibleTasks', () => {
  const tasks: TaskInfo[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1),
    subject: `T${i + 1}`,
    status: i < 5 ? 'completed' : i === 5 ? 'in_progress' : 'pending',
  }));

  it('shows everything when the list fits', () => {
    expect(visibleTasks(tasks.slice(0, 4), 5)).toEqual({ shown: tasks.slice(0, 4), hidden: 0 });
  });

  it('keeps the running task in view and starts one completed task before it', () => {
    const { shown, hidden } = visibleTasks(tasks, 5);
    expect(shown.map((t) => t.id)).toEqual(['5', '6', '7', '8', '9']);
    expect(hidden).toBe(5);
  });
});
