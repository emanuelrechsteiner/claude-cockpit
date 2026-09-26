import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStatus, STALE_AFTER_SECONDS } from '../src/collect/status.js';
import { untilReset } from '../src/ui/cards/Usage.js';
import { bar, pctColor } from '../src/ui/cards/Context.js';
import { Collector } from '../src/collect/collector.js';
import { loadRules } from '../src/rules.js';

const rules = loadRules(new URL('../config/rules.json', import.meta.url).pathname);

function run(input: string, dir: string): string {
  return execFileSync('bash', ['statusline/statusline.sh'], {
    input,
    env: { ...process.env, COCKPIT_DIR: dir },
    encoding: 'utf8',
  });
}

const FULL = JSON.stringify({
  session_id: 's1',
  model: { display_name: 'Opus 5' },
  context_window: {
    used_percentage: 31.4,
    context_window_size: 1_000_000,
    total_input_tokens: 314_000,
    total_output_tokens: 12_000,
    // Deliberately CONTRADICTORY values: current_usage only counts the last
    // API call, total_* the tokens in the window. Really measured 2026-08-04
    // at 41% of a 1M window: total_input_tokens ~410000, current_usage
    // .input_tokens = 2. Taking the wrong field here shows a number that is
    // correct and still says the wrong thing — hence this test case.
    current_usage: { input_tokens: 2, output_tokens: 178 },
  },
  cost: { total_cost_usd: 20.69, total_duration_ms: 900_000, total_lines_added: 578, total_lines_removed: 303 },
  workspace: { current_dir: '/tmp' },
  rate_limits: {
    five_hour: { used_percentage: 42, resets_at: 1_785_835_200 },
    seven_day: { used_percentage: 18, resets_at: 1_786_267_200 },
  },
});

describe('statusline.sh as a mailbox', () => {
  it('drops the numbers per session and still shows the status line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const out = run(FULL, dir);
    expect(out).toContain('Opus 5');
    expect(out).toContain('31%');

    const s = readStatus(join(dir, 'status-s1.json'), 1_785_829_600);
    expect(s.contextPct).toBe(31.4);
    expect(s.windowSize).toBe(1_000_000);
    // total_input_tokens (window), NOT current_usage.input_tokens (2)
    expect(s.inputTokens).toBe(314_000);
    expect(s.outputTokens).toBe(12_000);
    expect(s.costUsd).toBe(20.69);
    expect(s.linesAdded).toBe(578);
    expect(s.fiveHour).toEqual({ usedPercentage: 42, resetsAt: 1_785_835_200 });
    expect(s.sevenDay).toEqual({ usedPercentage: 18, resetsAt: 1_786_267_200 });
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes PER SESSION — two sessions do not overwrite each other', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(FULL, dir);
    run(FULL.replace('"s1"', '"s2"').replace('31.4', '77'), dir);
    expect(readStatus(join(dir, 'status-s1.json')).contextPct).toBe(31.4);
    expect(readStatus(join(dir, 'status-s2.json')).contextPct).toBe(77);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports missing rate_limits as null, NOT as 0 percent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(JSON.stringify({ session_id: 's3', context_window: { used_percentage: 5 } }), dir);
    const s = readStatus(join(dir, 'status-s3.json'));
    expect(s.fiveHour).toBeNull();
    expect(s.sevenDay).toBeNull();
    expect(s.contextPct).toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('never fails: missing target directory, missing session_id, garbage input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    expect(() => run(FULL, '/nonexistent/path')).not.toThrow();
    // without a session_id, the mailbox stays EMPTY instead of writing a global file
    run(JSON.stringify({ context_window: { used_percentage: 5 } }), dir);
    expect(readdirSync(dir).filter((f) => f.startsWith('status'))).toHaveLength(0);
    expect(() => run('not-json{{{', dir)).not.toThrow();
    // no half-written files: the staging file is always cleaned up
    expect(readdirSync(dir).filter((f) => f.startsWith('.status.'))).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('readStatus', () => {
  it('marks stale readings instead of showing them unmarked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'status-x.json');
    writeFileSync(p, JSON.stringify({ ts: 1000, context: { used_percentage: 10 } }));
    expect(readStatus(p, 1000 + STALE_AFTER_SECONDS - 1).stale).toBe(false);
    expect(readStatus(p, 1000 + STALE_AFTER_SECONDS + 1).stale).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('turns missing fields into null, not 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'status-y.json');
    writeFileSync(p, JSON.stringify({ ts: 1 }));
    const s = readStatus(p, 1);
    expect(s.contextPct).toBeNull();
    expect(s.costUsd).toBeNull();
    expect(s.fiveHour).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Collector with a mailbox', () => {
  it('reports the missing mailbox as a waiting source, instead of throwing', async () => {
    const c = new Collector({
      eventsPath: '/nonexistent/e.jsonl',
      rules,
      skipAgents: true,
      statusPath: '/nonexistent/status.json',
    });
    const state = await c.poll();
    expect(state.status).toBeNull();
    expect(state.errors.some((e) => e.source === 'status' && e.reason.includes('waiting'))).toBe(true);
  });

  it('passes an existing reading through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(FULL, dir);
    const p = join(dir, 'status-s1.json');
    expect(existsSync(p)).toBe(true);
    const c = new Collector({ eventsPath: '/nonexistent/e.jsonl', rules, skipAgents: true, statusPath: p });
    const state = await c.poll();
    expect(state.status?.contextPct).toBe(31.4);
    expect(state.status?.fiveHour?.usedPercentage).toBe(42);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Rendering', () => {
  it('untilReset computes hours, minutes, and days', () => {
    expect(untilReset(1000 + 45 * 60, 1000)).toBe('45 min left');
    expect(untilReset(1000 + 2 * 3600 + 15 * 60, 1000)).toBe('2 h 15 min left');
    expect(untilReset(1000 + 50 * 3600, 1000)).toBe('2 d 2 h left');
    expect(untilReset(500, 1000)).toBe('reset');
    expect(untilReset(null, 1000)).toBe('');
  });

  it('bar always stays the same width and does not grow longer for outliers', () => {
    expect(bar(0, 10)).toBe('░'.repeat(10));
    expect(bar(100, 10)).toBe('█'.repeat(10));
    expect(bar(50, 10)).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(bar(-5, 10)).toHaveLength(10);
    expect(bar(999, 10)).toBe('█'.repeat(10));
  });

  it('pctColor switches at 50 and 75 — like the status line', () => {
    expect(pctColor(49)).toBe('green');
    expect(pctColor(50)).toBe('yellow');
    expect(pctColor(74)).toBe('yellow');
    expect(pctColor(75)).toBe('red');
  });
});

/** The raw file stays readable — regression against a broken jq filter. */
describe('Mailbox format', () => {
  it('is exactly one line of valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(FULL, dir);
    const raw = readFileSync(join(dir, 'status-s1.json'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(raw)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
