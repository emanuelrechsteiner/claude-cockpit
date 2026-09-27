import { describe, it, expect } from 'vitest';
import { reduceEvents, emptyEventState, mergeDispatches } from '../src/parse/events.js';
import { subagentRows } from '../src/ui/cards/subagent-view.js';
import type { Dispatch } from '../src/parse/dispatch-map.js';

/** Payload shapes of events-59977e20…jsonl: starts keyed by tool_use_id, stops by agent_id. */
function start(ts: number, toolUseId: string, description: string): string {
  return JSON.stringify({
    ts,
    event: 'SubagentStart',
    data: { tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { subagent_type: 'backend-agent', description } },
  });
}
function stop(ts: number, agentId: string): string {
  return JSON.stringify({ ts, event: 'SubagentStop', data: { agent_type: 'backend-agent', agent_id: agentId, last_assistant_message: `done ${agentId}` } });
}

/** Transcript outcome of the three calls: B refused by the classifier (real case toolu_01Ktw81i…). */
const dispatches: Dispatch[] = [
  { toolUseId: 'toolu_A', agentId: 'agentA', denied: false },
  { toolUseId: 'toolu_B', agentId: null, denied: true },
  { toolUseId: 'toolu_C', agentId: 'agentC', denied: false },
];
const starts = [start(1, 'toolu_A', 'A'), start(2, 'toolu_B', 'B'), start(3, 'toolu_C', 'C')];
const statusOf = (s: ReturnType<typeof reduceEvents>) => Object.fromEntries(s.subagents.map((a) => [a.id, a.status]));

describe('stop attribution through the transcript dispatch map', () => {
  it('ghost scenario: A and C done, denied B shown as denied, nothing running', () => {
    const withMap = mergeDispatches(reduceEvents(starts, emptyEventState()), dispatches);
    const s = reduceEvents([stop(10, 'agentC'), stop(11, 'agentA')], withMap);
    expect(statusOf(s)).toEqual({ toolu_A: 'done', toolu_B: 'denied', toolu_C: 'done' });
    expect(s.subagents.find((a) => a.id === 'toolu_C')).toMatchObject({ endedAt: 10, lastMessage: 'done agentC' });
    expect(s.subagents.find((a) => a.id === 'toolu_B')?.endedAt).toBe(2);
    expect(s.unmatchedStops).toBe(0);
    expect(s.workflows[1]).toMatchObject({ done: 3, total: 3 });
  });

  it('a stop that arrives before its mapping is re-attributed once the mapping arrives', () => {
    // Poll 1: C's stop, no transcript yet → heuristic closes the oldest (A) — wrong.
    const early = reduceEvents([...starts, stop(10, 'agentC')], emptyEventState());
    expect(statusOf(early)).toEqual({ toolu_A: 'done', toolu_B: 'running', toolu_C: 'running' });
    expect(early.unmatchedStops).toBe(1);
    // Poll 2: the mapping arrives → C closed, A running again, B denied.
    const fixed = mergeDispatches(early, dispatches);
    expect(statusOf(fixed)).toEqual({ toolu_A: 'running', toolu_B: 'denied', toolu_C: 'done' });
    expect(fixed.unmatchedStops).toBe(0);
    expect(fixed.workflows[1]).toMatchObject({ done: 2, total: 3 });
    // Poll 3: A's stop → everything finished.
    expect(statusOf(reduceEvents([stop(12, 'agentA')], fixed))).toEqual({ toolu_A: 'done', toolu_B: 'denied', toolu_C: 'done' });
  });

  it('mapping split across polls: denied known first, agent ids later', () => {
    const s0 = mergeDispatches(reduceEvents(starts, emptyEventState()), [dispatches[1]]);
    const s1 = reduceEvents([stop(10, 'agentC')], s0);
    // B is denied, so the heuristic may not pick it; A is the oldest candidate.
    expect(statusOf(s1)).toEqual({ toolu_A: 'done', toolu_B: 'denied', toolu_C: 'running' });
    const s2 = mergeDispatches(s1, [dispatches[0], dispatches[2]]);
    expect(statusOf(s2)).toEqual({ toolu_A: 'running', toolu_B: 'denied', toolu_C: 'done' });
  });

  it('no transcript: the oldest-same-type heuristic still closes rows and counts each fallback', () => {
    const s = reduceEvents([...starts, stop(10, 'agentX'), stop(11, 'agentY')], emptyEventState());
    expect(statusOf(s)).toEqual({ toolu_A: 'done', toolu_B: 'done', toolu_C: 'running' });
    expect(s.unmatchedStops).toBe(2);
  });

  it('a heuristic stop never takes a start that a linked stop claims', () => {
    const map = mergeDispatches(reduceEvents(starts, emptyEventState()), [dispatches[0]]);
    // An unlinked stop first: A is claimed by agentA's (later) stop, so it goes to B.
    const s = reduceEvents([stop(10, 'agentX'), stop(11, 'agentA')], map);
    expect(statusOf(s)).toEqual({ toolu_A: 'done', toolu_B: 'done', toolu_C: 'running' });
    expect(s.unmatchedStops).toBe(1);
  });

  it('a restart still marks unfinished rows lost, but not denied ones', () => {
    const restart = JSON.stringify({ ts: 20, event: 'SessionStart', data: { source: 'resume' } });
    const s = reduceEvents([restart], mergeDispatches(reduceEvents(starts, emptyEventState()), dispatches));
    expect(statusOf(s)).toEqual({ toolu_A: 'lost', toolu_B: 'denied', toolu_C: 'lost' });
  });
});

describe('denied row on Card 3', () => {
  it('renders gray ⊘ with "denied · not started", not as running', () => {
    const s = mergeDispatches(reduceEvents([starts[1]], emptyEventState()), [dispatches[1]]);
    const rows = subagentRows({ events: s.subagents, live: null, defs: new Map(), sessionModel: null, now: 100_000 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ icon: '⊘', color: 'gray', activity: 'denied · not started', running: false });
  });
});
