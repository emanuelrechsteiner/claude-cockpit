import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reduceEvents, emptyEventState } from '../src/parse/events.js';
import { readAgentDefs } from '../src/collect/agent-defs.js';
import { subagentRows } from '../src/ui/cards/subagent-view.js';

/** Payload shapes copied from a captured events-<sid>.jsonl (2026-09-26). */
function start(ts: number, type: string, description: string, model?: string): string {
  return JSON.stringify({
    ts,
    event: 'SubagentStart',
    data: {
      tool_name: 'Agent',
      tool_input: { subagent_type: type, description, ...(model ? { model } : {}) },
      effort: { level: 'max' },
    },
  });
}

function stop(ts: number, agentType: string, last = ''): string {
  return JSON.stringify({ ts, event: 'SubagentStop', data: { agent_type: agentType, agent_id: `x${ts}`, last_assistant_message: last } });
}

describe('subagent lifecycle from hook events', () => {
  it('ignores SubagentStop without agent_type (Claude Code internal helpers)', () => {
    // Real ratio 2026-09-26: 677 of 687 stops carried agent_type "". Each of
    // them used to close the oldest running subagent.
    const s = reduceEvents([start(1, 'ui-agent', 'Block motif'), stop(2, ''), stop(3, '')], emptyEventState());
    expect(s.subagents[0]).toMatchObject({ type: 'ui-agent', status: 'running' });
  });

  it('closes the oldest running subagent of the same type only', () => {
    const s = reduceEvents(
      [start(1, 'ui-agent', 'A'), start(2, 'backend-agent', 'B'), stop(3, 'backend-agent', 'Done: route added.')],
      emptyEventState(),
    );
    expect(s.subagents.map((a) => [a.type, a.status])).toEqual([
      ['ui-agent', 'running'],
      ['backend-agent', 'done'],
    ]);
    expect(s.subagents[1].lastMessage).toBe('Done: route added.');
  });

  it('keeps description, requested model and session effort from the start event', () => {
    const s = reduceEvents([start(1, 'backend-agent', 'W2-F Wareneingang', 'opus')], emptyEventState());
    expect(s.subagents[0]).toMatchObject({ description: 'W2-F Wareneingang', model: 'opus', sessionEffort: 'max' });
  });
});

describe('subagents across a session restart', () => {
  function sessionStart(ts: number, source: string): string {
    return JSON.stringify({ ts, event: 'SessionStart', data: { source } });
  }
  it('marks still-running subagents as lost on resume/startup, but not on compact', () => {
    const afterCompact = reduceEvents([start(1, 'visual-qa-agent', 'QA'), sessionStart(2, 'compact')], emptyEventState());
    expect(afterCompact.subagents[0].status).toBe('running');
    const afterResume = reduceEvents([sessionStart(3, 'resume')], afterCompact);
    expect(afterResume.subagents[0]).toMatchObject({ status: 'lost', endedAt: 3 });
  });
});

describe('readAgentDefs', () => {
  it('reads model and effort from agent frontmatter', () => {
    const d = mkdtempSync(join(tmpdir(), 'agents-'));
    writeFileSync(join(d, 'ui-agent.md'), '---\nname: ui-agent\nmodel: sonnet\neffort: high\n---\nbody model: nope\n');
    writeFileSync(join(d, 'planning-agent.md'), '---\nname: planning-agent\nmodel: opus\n---\n');
    const defs = readAgentDefs(d);
    expect(defs.get('ui-agent')).toEqual({ model: 'sonnet', effort: 'high' });
    expect(defs.get('planning-agent')).toEqual({ model: 'opus', effort: null });
    rmSync(d, { recursive: true, force: true });
  });

  it('returns an empty map for a missing directory', () => {
    expect(readAgentDefs('/does/not/exist').size).toBe(0);
  });
});

describe('subagentRows', () => {
  const now = 10 * 60_000;
  const defs = new Map([['ui-agent', { model: 'sonnet', effort: null }]]);

  it('always shows model and effort, and "idle" once a subagent is done', () => {
    const rows = subagentRows({
      events: [
        { id: 'a', type: 'ui-agent', status: 'done', startedAt: 0, endedAt: now - 4 * 60_000, description: 'Block motif', model: null, sessionEffort: 'max', lastMessage: 'x' },
      ],
      live: null,
      defs,
      sessionModel: 'Opus 5.5 (1M context)',
      now,
    });
    expect(rows[0]).toMatchObject({ title: 'ui-agent', meta: 'Sonnet · max', activity: 'idle · done 4 min ago', icon: '✓' });
  });

  it('falls back to the session model when neither call nor definition names one', () => {
    const rows = subagentRows({
      events: [{ id: 'b', type: 'claude-code-guide', status: 'running', startedAt: now - 42_000, description: 'Research hooks', model: null, sessionEffort: 'max', lastMessage: null }],
      live: null,
      defs,
      sessionModel: 'Opus 5.5 (1M context)',
      now,
    });
    expect(rows[0]).toMatchObject({ meta: 'Opus 5.5 · max · 42s', activity: 'Research hooks', icon: '⟳' });
  });

  // Live-mailbox tests (completed/failed/running live agents, generic
  // local_agent matching, live/event de-duplication) live in
  // tests/subagent-rows-live.test.ts.
});
