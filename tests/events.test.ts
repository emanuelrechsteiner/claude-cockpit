import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reduceEvents, emptyEventState } from '../src/parse/events.js';

const lines = readFileSync(new URL('./fixtures/events-sample.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n');

describe('reduceEvents', () => {
  const state = reduceEvents(lines, emptyEventState());
  it('tracks subagent lifecycle to done', () => {
    expect(state.subagents).toHaveLength(1);
    expect(state.subagents[0]).toMatchObject({ id: 'a1', type: 'research-agent', status: 'done' });
  });
  it('counts workflow progress', () => {
    expect(state.workflows[0]).toMatchObject({ done: 1, total: 1 });
  });
});

describe('reduceEvents with real hook payload shapes', () => {
  it('reads subagent_type from PreToolUse tool_input; stop without id closes oldest running', () => {
    const real = [
      JSON.stringify({ ts: 10, event: 'SubagentStart', data: { session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'backend-agent' } } }),
      JSON.stringify({ ts: 20, event: 'SubagentStop', data: { session_id: 's' } }),
      JSON.stringify({ ts: 30, event: 'TaskUpdated', data: { tool_input: { status: 'completed' } } }),
      JSON.stringify({ ts: 31, event: 'TaskCreated', data: { tool_input: { subject: 'x' } } }),
    ];
    const s = reduceEvents(real, emptyEventState());
    expect(s.subagents[0]).toMatchObject({ type: 'backend-agent', status: 'done' });
    expect(s.workflows[0]).toMatchObject({ done: 1, total: 1 });
  });
  it('TaskUpdated without completed status does not count as done', () => {
    const s = reduceEvents(
      [JSON.stringify({ ts: 1, event: 'TaskUpdated', data: { tool_input: { status: 'in_progress' } } })],
      emptyEventState(),
    );
    expect(s.workflows[0].done).toBe(0);
  });
});
