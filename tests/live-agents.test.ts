import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLiveAgents, LIVE_STALE_AFTER_SECONDS } from '../src/collect/live-agents.js';
import { formatModel, formatEffort, agentGlyph } from '../src/ui/cards/subagent-view.js';

/** Shape per code.claude.com/docs/en/statusline#subagent-status-lines */
const payload = {
  session_id: 'sid1',
  columns: 80,
  tasks: [
    {
      id: 't1',
      name: 'backend-agent',
      type: 'backend-agent',
      status: 'running',
      description: 'Add /health route',
      label: 'Edit src/routes/health.ts',
      startTime: 1_000,
      model: 'claude-sonnet-5',
      effort: 'medium',
      tokenCount: 12_000,
      contextWindowSize: 200_000,
    },
  ],
};

function runScript(dir: string, inCockpit: '0' | '1'): string {
  return execFileSync('bash', ['statusline/subagent-statusline.sh'], {
    input: JSON.stringify(payload),
    env: { ...process.env, COCKPIT_DIR: dir, COCKPIT_IN_COCKPIT: inCockpit },
  }).toString();
}

describe('subagent-statusline.sh', () => {
  it('drops the task list into subagents-<sid>.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    runScript(dir, '0');
    const box = JSON.parse(readFileSync(join(dir, 'subagents-sid1.json'), 'utf8')) as { ts: number; tasks: { id: string; model: string }[] };
    expect(box.tasks).toHaveLength(1);
    expect(box.tasks[0]).toMatchObject({ id: 't1', model: 'claude-sonnet-5' });
    expect(box.ts).toBeTypeOf('number');
    rmSync(dir, { recursive: true, force: true });
  });

  it('hides every panel row inside a cockpit session (empty content per id)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const out = runScript(dir, '1').trim().split('\n').map((l) => JSON.parse(l) as unknown);
    expect(out).toEqual([{ id: 't1', content: '' }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints nothing outside a cockpit session, so Claude Code keeps its own rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    expect(runScript(dir, '0')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 on garbage input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    execFileSync('bash', ['statusline/subagent-statusline.sh'], { input: 'nope', env: { ...process.env, COCKPIT_DIR: dir } });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('readLiveAgents', () => {
  it('reads the mailbox and marks it stale after the threshold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'subagents-sid1.json');
    writeFileSync(p, JSON.stringify({ ts: 100, tasks: payload.tasks }));
    const fresh = readLiveAgents(p, 100 + LIVE_STALE_AFTER_SECONDS);
    expect(fresh.stale).toBe(false);
    expect(fresh.agents[0]).toMatchObject({ id: 't1', type: 'backend-agent', model: 'claude-sonnet-5', effort: 'medium', label: 'Edit src/routes/health.ts' });
    expect(readLiveAgents(p, 100 + LIVE_STALE_AFTER_SECONDS + 1).stale).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps absent fields as null instead of inventing them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'subagents-sid1.json');
    writeFileSync(p, JSON.stringify({ ts: 1, tasks: [{ id: 'x', status: 'running' }] }));
    expect(readLiveAgents(p, 1).agents[0]).toMatchObject({ id: 'x', model: null, effort: null, description: null });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('subagent view helpers', () => {
  it('turns model ids into short names', () => {
    expect(formatModel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(formatModel('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(formatModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(formatModel('claude-fable-5-1')).toBe('Fable 5.1');
    expect(formatModel(null)).toBeNull();
  });

  it('shows effort levels as words and budgets as token counts', () => {
    expect(formatEffort('high')).toBe('high');
    expect(formatEffort(8000)).toBe('8k tok');
    expect(formatEffort(null)).toBeNull();
  });

  it('maps statuses to the Cockpit glyphs', () => {
    expect(agentGlyph('running')).toEqual({ icon: '⟳', color: 'yellow' });
    expect(agentGlyph('completed')).toEqual({ icon: '✓', color: 'green' });
    expect(agentGlyph('failed')).toEqual({ icon: '✗', color: 'red' });
    expect(agentGlyph('waiting')).toEqual({ icon: '●', color: 'yellow' });
  });
});
