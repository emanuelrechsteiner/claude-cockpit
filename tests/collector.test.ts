import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../src/collect/collector.js';
import { loadRules } from '../src/rules.js';

const rules = loadRules(new URL('../config/rules.json', import.meta.url).pathname);

describe('Collector', () => {
  it('reports unreadable sources as errors instead of throwing', async () => {
    const c = new Collector({
      eventsPath: '/nonexistent/events.jsonl',
      transcriptPath: '/nonexistent/t.jsonl',
      rules,
      skipAgents: true,
    });
    const state = await c.poll();
    expect(state.errors.length).toBe(2);
    expect(state.errors[0].reason).toContain('waiting');
  });

  it('aggregates fixtures end-to-end, incrementally without duplicates', async () => {
    const c = new Collector({
      eventsPath: new URL('./fixtures/events-sample.jsonl', import.meta.url).pathname,
      transcriptPath: new URL('./fixtures/transcript-sample.jsonl', import.meta.url).pathname,
      rules,
      skipAgents: true,
    });
    const state = await c.poll();
    expect(state.subagents).toHaveLength(1);
    expect(state.links.length).toBe(2);
    expect(state.files.length).toBe(2);
    const second = await c.poll();
    expect(second.links.length).toBe(state.links.length);
    expect(second.subagents).toHaveLength(1);
  });
});

describe('Collector data honesty', () => {
  function tmp(): string {
    return mkdtempSync(join(tmpdir(), 'cockpit-col-'));
  }

  it('reports unreadable event lines as a visible error', async () => {
    const d = tmp();
    const events = join(d, 'events.jsonl');
    writeFileSync(events, `garbage\n${JSON.stringify({ ts: 7, event: 'TaskCreated', data: { tool_input: { subject: 'x' } } })}\n`);
    const state = await new Collector({ eventsPath: events, rules, skipAgents: true }).poll();
    expect(state.errors).toContainEqual({ source: 'events', reason: '1 unreadable line(s) — some tasks/subagents may be missing' });
    expect(state.unreadableEvents).toBe(1);
    expect(state.lastEventTs).toBe(7);
    rmSync(d, { recursive: true, force: true });
  });

  it('adds no unreadable error for clean fixtures', async () => {
    const state = await new Collector({ eventsPath: new URL('./fixtures/events-sample.jsonl', import.meta.url).pathname, rules, skipAgents: true }).poll();
    expect(state.errors).toEqual([]);
    expect(state.unreadableEvents).toBe(0);
  });

  it('reports each sensor file mtime; missing file or unset path → null', async () => {
    const d = tmp();
    const events = join(d, 'events.jsonl');
    const status = join(d, 'status.json');
    writeFileSync(events, '');
    writeFileSync(status, JSON.stringify({ ts: 1 }));
    utimesSync(events, 1_000, 1_000);
    utimesSync(status, 2_000, 2_000);
    const withLive = await new Collector({ eventsPath: events, statusPath: status, liveAgentsPath: join(d, 'missing.json'), rules, skipAgents: true }).poll();
    expect(withLive.freshness).toEqual({ eventsMs: 1_000_000, statusMs: 2_000_000, liveMs: null });
    const unset = await new Collector({ eventsPath: join(d, 'none.jsonl'), rules, skipAgents: true }).poll();
    expect(unset.freshness).toEqual({ eventsMs: null, statusMs: null, liveMs: null });
    rmSync(d, { recursive: true, force: true });
  });

  it('reports a stat failure other than a missing file (fail loud)', async () => {
    const d = tmp();
    const notDir = join(d, 'file');
    writeFileSync(notDir, '');
    const state = await new Collector({ eventsPath: join(d, 'none.jsonl'), liveAgentsPath: join(notDir, 'live.json'), rules, skipAgents: true }).poll();
    expect(state.freshness?.liveMs).toBeNull();
    expect(state.errors.some((e) => e.source === 'subagents' && e.reason.startsWith('cannot read file age:') && e.reason.includes('ENOTDIR'))).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('Collector — dispatch map and cut-off records', () => {
  const ev = (o: object) => `${JSON.stringify(o)}\n`;
  const start = (ts: number, id: string) => ev({ ts, event: 'SubagentStart', data: { tool_use_id: id, tool_input: { subagent_type: 'backend-agent' } } });
  const stop = (ts: number, agentId: string) => ev({ ts, event: 'SubagentStop', data: { agent_type: 'backend-agent', agent_id: agentId } });
  const call = (id: string) => ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: {} }] } });
  const result = (id: string, agentId: string | null) =>
    ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, ...(agentId ? {} : { is_error: true }) }] }, toolUseResult: agentId ? { agentId, status: 'async_launched' } : 'Error: denied' });

  it('re-attributes a stop when the transcript link arrives in a later poll', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cockpit-col-'));
    const events = join(d, 'events.jsonl');
    const transcript = join(d, 't.jsonl');
    writeFileSync(events, start(1, 'tA') + start(2, 'tB') + start(3, 'tC') + stop(10, 'aC'));
    writeFileSync(transcript, call('tA') + call('tB') + call('tC'));
    const c = new Collector({ eventsPath: events, transcriptPath: transcript, rules, skipAgents: true });
    const first = await c.poll();
    expect(first.subagents.map((s) => s.status)).toEqual(['done', 'running', 'running']);
    expect(first.unmatchedStops).toBe(1);
    appendFileSync(transcript, result('tA', 'aA') + result('tB', null) + result('tC', 'aC'));
    const second = await c.poll();
    expect(second.subagents.map((s) => [s.id, s.status])).toEqual([['tA', 'running'], ['tB', 'denied'], ['tC', 'done']]);
    expect(second.unmatchedStops).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });

  it('surfaces a record fragment still waiting after 2 polls without growth, and clears it once resolved', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cockpit-col-'));
    const events = join(d, 'events.jsonl');
    const full = JSON.stringify({ ts: 5, event: 'TaskCreated', data: { task_id: '1', task_name: 'x' } });
    const cut = full.indexOf('"data"');
    writeFileSync(events, `${full.slice(0, cut)}\n`);
    const c = new Collector({ eventsPath: events, rules, skipAgents: true });
    const reason = '1 record cut off at end of file — waiting for its tail';
    const has = (s: Awaited<ReturnType<Collector['poll']>>) => s.errors.some((e) => e.source === 'events' && e.reason === reason);
    expect(has(await c.poll())).toBe(false); // grew: the head just arrived
    expect(has(await c.poll())).toBe(false); // 1st poll without growth
    expect(has(await c.poll())).toBe(true); // 2nd poll without growth
    appendFileSync(events, `${full.slice(cut)}\n`);
    const resolved = await c.poll();
    expect(has(resolved)).toBe(false);
    expect(resolved.unreadableEvents).toBe(0);
    expect(resolved.errors).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('Collector — multibyte UTF-8 read position', () => {
  const ev = (o: object) => `${JSON.stringify(o)}\n`;
  // Long multibyte padding: the old char-index offset fell far short of the
  // byte position, so a later poll re-read from the middle of a record.
  const pad = 'Ärger — über 🚀 '.repeat(40);

  it('4 polls over an unchanged multibyte file: no unreadable lines, identical state', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cockpit-col-'));
    const events = join(d, 'events.jsonl');
    writeFileSync(
      events,
      ev({ ts: 1, event: 'TaskCreated', data: { task_id: 't1', task_name: `Parser ${pad}` } }) +
        ev({ ts: 2, event: 'SubagentStart', data: { subagent_id: 'a1', subagent_type: 'research-agent', note: pad } }) +
        ev({ ts: 3, event: 'TaskCreated', data: { task_id: 't2', task_name: `Täst ${pad}` } }) +
        ev({ ts: 4, event: 'TaskCompleted', data: { task_id: 't1', result_status: 'success', note: pad } }),
    );
    const c = new Collector({ eventsPath: events, rules, skipAgents: true });
    const polls = [];
    for (let i = 0; i < 4; i++) polls.push(await c.poll());
    expect(polls.map((s) => s.unreadableEvents)).toEqual([0, 0, 0, 0]);
    for (const s of polls) {
      expect(s.errors).toEqual([]);
      expect(s.workflows).toEqual(polls[0].workflows);
      expect(s.subagents).toEqual(polls[0].subagents);
    }
    rmSync(d, { recursive: true, force: true });
  });

  it('a finished subagent in a multibyte file stays done across polls', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cockpit-col-'));
    const events = join(d, 'events.jsonl');
    // All multibyte weight sits BEFORE the start/stop pair, so a char-index
    // offset lands before both records and a re-read re-applies the start.
    writeFileSync(
      events,
      ev({ ts: 1, event: 'TaskCreated', data: { task_id: 't1', task_name: '—'.repeat(2000) } }) +
        ev({ ts: 2, event: 'SubagentStart', data: { subagent_id: 'a1', subagent_type: 'research-agent' } }) +
        ev({ ts: 4, event: 'SubagentStop', data: { subagent_id: 'a1', result_status: 'success' } }),
    );
    const c = new Collector({ eventsPath: events, rules, skipAgents: true });
    for (let i = 0; i < 4; i++) {
      const s = await c.poll();
      expect(s.subagents.map((a) => a.status)).toEqual(['done']);
      expect(s.unreadableEvents).toBe(0);
    }
    rmSync(d, { recursive: true, force: true });
  });
});
