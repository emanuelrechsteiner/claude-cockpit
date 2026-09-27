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

describe('reduceEvents with unreadable lines', () => {
  function created(ts: number, id: string): string {
    return JSON.stringify({ ts, event: 'TaskCreated', data: { tool_input: { subject: `T${id}` }, tool_response: { task: { id } } } });
  }
  function updated(ts: number, id: string): string {
    return JSON.stringify({
      ts,
      event: 'TaskUpdated',
      data: {
        tool_input: { taskId: id, status: 'completed' },
        tool_response: { success: true, taskId: id, statusChange: { from: 'in_progress', to: 'completed' } },
      },
    });
  }

  /**
   * Real lines 571–572 of events-59977e20…jsonl: task 11's TaskUpdated cut
   * off after "to":"completed", task 12's complete TaskUpdated glued on, and
   * the rest of task 11 alone on the next line.
   */
  function interleaved(): { head: string; tail: string; line: string } {
    const first = updated(1790496531000, '11');
    const cut = first.indexOf('"to":"completed"') + '"to":"completed"'.length;
    const head = first.slice(0, cut);
    return { head, tail: first.slice(cut), line: head + updated(1790496531000, '12') };
  }
  const status = (s: ReturnType<typeof reduceEvents>, id: string) => s.workflows[0].tasks.find((t) => t.id === id)?.status;

  it('re-joins an interleaved record with the next line (real lines 571–572)', () => {
    const { line, tail } = interleaved();
    expect(() => JSON.parse(line)).toThrow();
    const s = reduceEvents([created(1, '11'), created(2, '12'), line, tail], emptyEventState());
    expect(s.unreadable).toBe(0);
    expect(status(s, '11')).toBe('completed');
    expect(status(s, '12')).toBe('completed');
    expect(s.workflows[0].done).toBe(2);
    expect(s.pendingFragment).toBeNull();
    expect(s.lastEventTs).toBe(1790496531000);
  });

  it('re-joins across a poll boundary: the head waits in the state, uncounted', () => {
    const { line, tail } = interleaved();
    const first = reduceEvents([created(1, '11'), created(2, '12'), line], emptyEventState());
    expect(first.unreadable).toBe(0);
    expect(first.pendingFragment).not.toBeNull();
    expect(status(first, '11')).toBe('pending');
    expect(status(first, '12')).toBe('completed');
    const second = reduceEvents([tail], first);
    expect(second.unreadable).toBe(0);
    expect(second.pendingFragment).toBeNull();
    expect(status(second, '11')).toBe('completed');
    expect(second.workflows[0].done).toBe(2);
  });

  it('a pending head survives an empty poll', () => {
    const { line, tail } = interleaved();
    const first = reduceEvents([created(1, '11'), line], emptyEventState());
    const idle = reduceEvents([], first);
    expect(idle.pendingFragment).toBe(first.pendingFragment);
    expect(status(reduceEvents([tail], idle), '11')).toBe('completed');
  });

  it('counts a dangling head once when the next line is an unrelated record', () => {
    const { head } = interleaved();
    const s = reduceEvents([created(1, '11'), head, created(3, '7')], emptyEventState());
    expect(s.unreadable).toBe(1);
    expect(s.pendingFragment).toBeNull();
    expect(status(s, '7')).toBe('pending');
    expect(status(s, '11')).toBe('pending');
  });

  it('counts a dangling head from the previous poll when the next line does not complete it', () => {
    const { head } = interleaved();
    const first = reduceEvents([head], emptyEventState());
    const second = reduceEvents([created(3, '7')], first);
    expect(second.unreadable).toBe(1);
    expect(second.workflows[0].total).toBe(1);
  });

  it('applies both objects when two complete events share a line', () => {
    const s = reduceEvents([created(1, '1') + created(2, '2')], emptyEventState());
    expect(s.unreadable).toBe(0);
    expect(s.workflows[0].total).toBe(2);
  });

  it('counts a fully garbled line, cumulatively across polls', () => {
    const first = reduceEvents(['not json at all'], emptyEventState());
    expect(first.unreadable).toBe(1);
    const second = reduceEvents(['{"ts":5,"event":', created(6, '1')], first);
    expect(second.unreadable).toBe(2);
    expect(second.workflows[0].total).toBe(1);
  });

  it('counts valid JSON that is not an event object', () => {
    expect(reduceEvents(['null', '42', '{"event":"TaskCreated"}'], emptyEventState()).unreadable).toBe(3);
  });

  it('reports 0 unreadable and the newest ts for normal lines', () => {
    const s = reduceEvents([created(30, '1'), created(10, '2')], emptyEventState());
    expect(s.unreadable).toBe(0);
    expect(s.lastEventTs).toBe(30);
  });

  it('starts with no events seen', () => {
    expect(emptyEventState()).toMatchObject({ unreadable: 0, lastEventTs: null, pendingFragment: null });
  });
});
