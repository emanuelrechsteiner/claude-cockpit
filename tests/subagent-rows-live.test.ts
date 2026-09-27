import { describe, it, expect } from 'vitest';
import { subagentRows } from '../src/ui/cards/subagent-view.js';

describe('subagentRows', () => {
  const now = 10 * 60_000;
  const defs = new Map([['ui-agent', { model: 'sonnet', effort: null }]]);

  it('prefers the live panel data for running subagents (resolved model, current label)', () => {
    const rows = subagentRows({
      events: [{ id: 'e', type: 'backend-agent', status: 'running', startedAt: now - 5_000, description: 'Add route', model: 'opus', sessionEffort: 'max', lastMessage: null }],
      live: {
        ts: 0,
        stale: false,
        agents: [{ id: 'L', name: 'backend-agent', type: 'backend-agent', status: 'running', description: 'Add route', label: 'Edit src/routes/health.ts', startTime: now - 5_000, model: 'claude-opus-5-5', effort: 'high', tokenCount: 1 }],
      },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'backend-agent', meta: 'Opus 5.5 · high · 5s', activity: 'Add route · Edit src/routes/health.ts' });
  });

  /** The live mailbox shape written by subagent-statusline.sh (real 2026-09-27). */
  function liveAgent(over: Partial<import('../src/types.js').LiveAgent>): import('../src/types.js').LiveAgent {
    return {
      id: 'a3e12c8bf208fe6f1',
      name: null,
      type: 'local_agent',
      status: 'completed',
      description: 'Mine framework-project transcripts',
      label: 'Writing mine-A.md report',
      startTime: now - 989 * 60_000,
      model: 'claude-sonnet-5',
      effort: null,
      tokenCount: 144482,
      ...over,
    };
  }
  const exploreEvent = (status: 'running' | 'done', over: Partial<import('../src/types.js').SubagentInfo> = {}) => ({
    id: 'toolu_01JD2FQUvx665fL6QHkpAzTv',
    type: 'Explore',
    status,
    startedAt: now - 990 * 60_000,
    ...(status === 'done' ? { endedAt: now - 2 * 60_000 } : {}),
    description: 'Mine framework-project transcripts',
    model: 'sonnet',
    sessionEffort: 'medium',
    lastMessage: null,
    ...over,
  });

  it('shows a completed live agent (real mailbox shape) as done, without elapsed time', () => {
    const rows = subagentRows({ events: [], live: { ts: 0, stale: false, agents: [liveAgent({})] }, defs, sessionModel: null, now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'local_agent', icon: '✓', meta: 'Sonnet 5', activity: 'idle · done', running: false });
    expect(rows[0].meta).not.toMatch(/\d+m \d{2}s/);
  });

  it('shows a failed/cancelled live agent as aborted, not running', () => {
    for (const status of ['failed', 'error', 'cancelled']) {
      const rows = subagentRows({ events: [], live: { ts: 0, stale: false, agents: [liveAgent({ status })] }, defs, sessionModel: null, now });
      expect(rows[0]).toMatchObject({ icon: '✗', activity: 'idle · aborted', running: false, meta: 'Sonnet 5' });
    }
  });

  it('keeps running/in_progress/active live agents running with elapsed time', () => {
    for (const status of ['running', 'in_progress', 'active']) {
      const rows = subagentRows({ events: [], live: { ts: 0, stale: false, agents: [liveAgent({ status, startTime: now - 5_000 })] }, defs, sessionModel: null, now });
      expect(rows[0]).toMatchObject({ icon: '⟳', running: true, meta: 'Sonnet 5 · 5s', activity: 'Mine framework-project transcripts · Writing mine-A.md report' });
    }
  });

  it('finished live + finished event: renders the event row once (event wins)', () => {
    const rows = subagentRows({ events: [exploreEvent('done')], live: { ts: 0, stale: false, agents: [liveAgent({})] }, defs, sessionModel: null, now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'toolu_01JD2FQUvx665fL6QHkpAzTv', title: 'Explore', activity: 'idle · done 2 min ago', running: false });
  });

  it('finished live + event without a stop yet: one finished row titled with the event type', () => {
    const rows = subagentRows({ events: [exploreEvent('running')], live: { ts: 0, stale: false, agents: [liveAgent({})] }, defs, sessionModel: null, now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'live-a3e12c8bf208fe6f1', title: 'Explore', activity: 'idle · done', running: false });
  });

  it('running generic live + running event: one live row titled with the event type (live wins)', () => {
    const rows = subagentRows({
      events: [exploreEvent('running')],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running' })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'live-a3e12c8bf208fe6f1', title: 'Explore', running: true, meta: 'Sonnet 5 · medium · 989m 00s' });
  });

  it('picks the event with the closest start time when descriptions repeat', () => {
    const older = exploreEvent('done', { id: 'old', type: 'research-agent', startedAt: now - 5000 * 60_000 });
    const rows = subagentRows({
      events: [older, exploreEvent('running')],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running' })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows.map((r) => r.title)).toEqual(['Explore', 'research-agent']);
  });

  it('keeps local_agent as the title when no event shares the description', () => {
    const rows = subagentRows({
      events: [exploreEvent('done', { description: 'Something else' })],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running' })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows.map((r) => [r.title, r.running])).toEqual([
      ['local_agent', true],
      ['Explore', false],
    ]);
  });

  it('fresh mailbox: a running event no live row represents keeps its row', () => {
    // Real 2026-09-27: 27 events + 3 mailbox entries rendered 26 rows — a
    // running agent the panel did not list was hidden by the fresh mailbox.
    const unlisted = exploreEvent('running', { id: 'ev-qa', type: 'visual-qa-agent', description: 'Screenshot card 3', startedAt: now - 30_000 });
    const rows = subagentRows({
      events: [exploreEvent('running'), unlisted],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running' })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows.map((r) => [r.key, r.title, r.running])).toEqual([
      ['live-a3e12c8bf208fe6f1', 'Explore', true],
      ['ev-qa', 'visual-qa-agent', true],
    ]);
  });

  it('fresh mailbox with an unrelated running live agent: both rows render', () => {
    const rows = subagentRows({
      events: [exploreEvent('running', { id: 'ev-be', type: 'backend-agent', description: 'Add route', startedAt: now - 10_000 })],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running', startTime: now - 5_000 })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows.map((r) => [r.key, r.title, r.running])).toEqual([
      ['live-a3e12c8bf208fe6f1', 'local_agent', true],
      ['ev-be', 'backend-agent', true],
    ]);
  });

  it('specific live type represents one running event of that type each, never more', () => {
    const one = exploreEvent('running', { id: 'b1', type: 'backend-agent', description: 'Route A' });
    const two = exploreEvent('running', { id: 'b2', type: 'backend-agent', description: 'Route B' });
    const rows = subagentRows({
      events: [one, two],
      live: { ts: 0, stale: false, agents: [liveAgent({ status: 'running', name: 'backend-agent', type: 'backend-agent', description: 'Route B' })] },
      defs,
      sessionModel: null,
      now,
    });
    // The description match (b2) is the one represented; b1 keeps its own row.
    expect(rows.map((r) => r.key)).toEqual(['live-a3e12c8bf208fe6f1', 'b1']);
  });

  it('a stale mailbox hides nothing: every event renders from the hook events', () => {
    const rows = subagentRows({
      events: [exploreEvent('running')],
      live: { ts: 0, stale: true, agents: [liveAgent({ status: 'running' })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows.map((r) => r.key)).toEqual(['toolu_01JD2FQUvx665fL6QHkpAzTv']);
  });

  it('finished live row with a specific type is not duplicated by its finished event', () => {
    const ev = { id: 'e1', type: 'backend-agent', status: 'done' as const, startedAt: now - 60_000, endedAt: now - 30_000, description: 'Add route', model: null, sessionEffort: 'max', lastMessage: null };
    const rows = subagentRows({
      events: [ev],
      live: { ts: 0, stale: false, agents: [liveAgent({ name: 'backend-agent', type: 'backend-agent', description: 'Add route', startTime: now - 60_000 })] },
      defs,
      sessionModel: null,
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('e1');
  });
});
