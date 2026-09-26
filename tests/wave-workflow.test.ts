import { describe, it, expect } from 'vitest';
import { reduceEvents, emptyEventState } from '../src/parse/events.js';
import { workflowBlocks } from '../src/ui/cards/workflow-view.js';

/** Payload shapes copied from a captured events-<sid>.jsonl (2026-09-26). */
function start(ts: number, type: string, description: string): string {
  return JSON.stringify({
    ts,
    event: 'SubagentStart',
    data: { tool_name: 'Agent', tool_input: { subagent_type: type, description } },
  });
}

function stop(ts: number, agentType: string): string {
  return JSON.stringify({ ts, event: 'SubagentStop', data: { agent_type: agentType, agent_id: `x${ts}` } });
}

function sessionStart(ts: number, source: string): string {
  return JSON.stringify({ ts, event: 'SessionStart', data: { source } });
}

function created(ts: number, id: string, subject: string): string {
  return JSON.stringify({
    ts,
    event: 'TaskCreated',
    data: { tool_input: { subject }, tool_response: { task: { id, subject } } },
  });
}

describe('parallel dispatch in the same second', () => {
  it('keeps both subagents when their starts share a timestamp (ids come from tool_use_id)', () => {
    const a = JSON.stringify({ ts: 5000, event: 'SubagentStart', data: { tool_use_id: 'toolu_A', tool_input: { subagent_type: 'ui-agent', description: 'A' } } });
    const b = JSON.stringify({ ts: 5000, event: 'SubagentStart', data: { tool_use_id: 'toolu_B', tool_input: { subagent_type: 'backend-agent', description: 'B' } } });
    const s = reduceEvents([a, b], emptyEventState());
    expect(s.subagents.map((x) => x.description)).toEqual(['A', 'B']);
    expect(s.workflows.find((w) => w.source === 'wave')?.total).toBe(2);
  });
});

describe('the Wave workflow (derived from subagent hook events)', () => {
  it('builds one row per subagent, in start order, subject = description', () => {
    const s = reduceEvents(
      [
        start(1, 'backend-agent', 'Wave 1 / A: build vault core'),
        start(2, 'ui-agent', 'Wave 1 / B: card 4'),
        start(3, 'testing-agent', 'Wave 1 / C: tests'),
        stop(4, 'backend-agent'),
      ],
      emptyEventState(),
    );
    const wave = s.workflows.find((w) => w.source === 'wave');
    expect(wave).toMatchObject({ name: 'Wave', done: 1, total: 3 });
    expect(wave?.tasks.map((t) => [t.subject, t.status])).toEqual([
      ['Wave 1 / A: build vault core', 'completed'],
      ['Wave 1 / B: card 4', 'in_progress'],
      ['Wave 1 / C: tests', 'in_progress'],
    ]);
  });

  it('falls back to the subagent type when no description was sent', () => {
    const s = reduceEvents(
      [JSON.stringify({ ts: 1, event: 'SubagentStart', data: { tool_input: { subagent_type: 'cleanup-agent' } } })],
      emptyEventState(),
    );
    const wave = s.workflows.find((w) => w.source === 'wave');
    expect(wave?.tasks[0]).toMatchObject({ subject: 'cleanup-agent', status: 'in_progress' });
  });

  it('does NOT react to TaskCreated/TaskUpdated — Tasks and Wave are independent counters', () => {
    const s = reduceEvents(
      [start(1, 'backend-agent', 'A'), created(2, 't1', 'Plan')],
      emptyEventState(),
    );
    const tasks = s.workflows.find((w) => w.source === 'tasks');
    const wave = s.workflows.find((w) => w.source === 'wave');
    expect(tasks).toMatchObject({ done: 0, total: 1 });
    expect(wave).toMatchObject({ done: 0, total: 1 });
  });

  it('marks a subagent lost on session resume as a finished (completed) Wave row, not stuck in_progress', () => {
    const afterStart = reduceEvents([start(1, 'visual-qa-agent', 'QA')], emptyEventState());
    const waveBefore = afterStart.workflows.find((w) => w.source === 'wave');
    expect(waveBefore).toMatchObject({ done: 0, total: 1 });

    const afterResume = reduceEvents([sessionStart(2, 'resume')], afterStart);
    const waveAfter = afterResume.workflows.find((w) => w.source === 'wave');
    expect(waveAfter).toMatchObject({ done: 1, total: 1 });
    expect(waveAfter?.tasks[0].status).toBe('completed');
  });

  it('an error result still counts as a finished row (TaskStatus has no separate error state)', () => {
    const s = reduceEvents(
      [
        JSON.stringify({
          ts: 1,
          event: 'SubagentStart',
          data: { tool_input: { subagent_type: 'backend-agent', description: 'X' } },
        }),
        JSON.stringify({ ts: 2, event: 'SubagentStop', data: { agent_type: 'backend-agent', result_status: 'error' } }),
      ],
      emptyEventState(),
    );
    const wave = s.workflows.find((w) => w.source === 'wave');
    expect(wave).toMatchObject({ done: 1, total: 1 });
    expect(wave?.tasks[0].status).toBe('completed');
  });

  it('emptyEventState already carries both workflows, both empty', () => {
    const e = emptyEventState();
    expect(e.workflows.map((w) => [w.source, w.total])).toEqual([
      ['tasks', 0],
      ['wave', 0],
    ]);
  });
});

describe('workflowBlocks (Card 4 row layout, no UI framework)', () => {
  it('skips empty workflows entirely', () => {
    expect(workflowBlocks([{ name: 'Tasks', source: 'tasks', done: 0, total: 0, tasks: [] }], 4)).toEqual([]);
  });

  it('numbers cursor rows continuously across two blocks (no two rows share cursor 0)', () => {
    const tasksWf = {
      name: 'Tasks',
      source: 'tasks' as const,
      done: 1,
      total: 2,
      tasks: [
        { id: 't1', subject: 'Plan', status: 'completed' as const },
        { id: 't2', subject: 'Build', status: 'in_progress' as const },
      ],
    };
    const waveWf = {
      name: 'Wave',
      source: 'wave' as const,
      done: 0,
      total: 1,
      tasks: [{ id: 'a1', subject: 'Wave 1 / A', status: 'in_progress' as const }],
    };
    const blocks = workflowBlocks([tasksWf, waveWf], 4);
    expect(blocks).toHaveLength(2);
    // Tasks: bar at row 0, two tasks at rows 1 and 2.
    expect(blocks[0]).toMatchObject({ name: 'Tasks', barRow: 0 });
    expect(blocks[0].taskRows.map((r) => r.row)).toEqual([1, 2]);
    // Wave continues right after: bar at row 3, its one task at row 4.
    expect(blocks[1]).toMatchObject({ name: 'Wave', barRow: 3 });
    expect(blocks[1].taskRows.map((r) => r.row)).toEqual([4]);
  });

  it('a single block alone still starts at row 0', () => {
    const waveWf = {
      name: 'Wave',
      source: 'wave' as const,
      done: 0,
      total: 1,
      tasks: [{ id: 'a1', subject: 'Solo', status: 'in_progress' as const }],
    };
    const blocks = workflowBlocks([{ name: 'Tasks', source: 'tasks' as const, done: 0, total: 0, tasks: [] }, waveWf], 4);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ name: 'Wave', barRow: 0 });
    expect(blocks[0].taskRows.map((r) => r.row)).toEqual([1]);
  });
});
