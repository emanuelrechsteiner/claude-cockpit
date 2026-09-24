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
    // Absichtlich WIDERSPRECHENDE Werte: current_usage zaehlt nur den letzten
    // API-Aufruf, total_* die Token im Fenster. Real gemessen 2026-08-04 bei
    // 41 % eines 1-Mio-Fensters: total_input_tokens ~410000, current_usage
    // .input_tokens = 2. Wer hier das falsche Feld nimmt, zeigt eine Zahl an,
    // die stimmt und trotzdem das Falsche aussagt — deshalb dieser Testfall.
    current_usage: { input_tokens: 2, output_tokens: 178 },
  },
  cost: { total_cost_usd: 20.69, total_duration_ms: 900_000, total_lines_added: 578, total_lines_removed: 303 },
  workspace: { current_dir: '/tmp' },
  rate_limits: {
    five_hour: { used_percentage: 42, resets_at: 1_785_835_200 },
    seven_day: { used_percentage: 18, resets_at: 1_786_267_200 },
  },
});

describe('statusline.sh als Briefkasten', () => {
  it('legt die Zahlen pro Sitzung ab und zeigt weiterhin die Statuszeile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const out = run(FULL, dir);
    expect(out).toContain('Opus 5');
    expect(out).toContain('31%');

    const s = readStatus(join(dir, 'status-s1.json'), 1_785_829_600);
    expect(s.contextPct).toBe(31.4);
    expect(s.windowSize).toBe(1_000_000);
    // total_input_tokens (Fenster), NICHT current_usage.input_tokens (2)
    expect(s.inputTokens).toBe(314_000);
    expect(s.outputTokens).toBe(12_000);
    expect(s.costUsd).toBe(20.69);
    expect(s.linesAdded).toBe(578);
    expect(s.fiveHour).toEqual({ usedPercentage: 42, resetsAt: 1_785_835_200 });
    expect(s.sevenDay).toEqual({ usedPercentage: 18, resetsAt: 1_786_267_200 });
    rmSync(dir, { recursive: true, force: true });
  });

  it('schreibt PRO SITZUNG — zwei Sitzungen überschreiben sich nicht', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(FULL, dir);
    run(FULL.replace('"s1"', '"s2"').replace('31.4', '77'), dir);
    expect(readStatus(join(dir, 'status-s1.json')).contextPct).toBe(31.4);
    expect(readStatus(join(dir, 'status-s2.json')).contextPct).toBe(77);
    rmSync(dir, { recursive: true, force: true });
  });

  it('meldet fehlende rate_limits als null, NICHT als 0 Prozent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(JSON.stringify({ session_id: 's3', context_window: { used_percentage: 5 } }), dir);
    const s = readStatus(join(dir, 'status-s3.json'));
    expect(s.fiveHour).toBeNull();
    expect(s.sevenDay).toBeNull();
    expect(s.contextPct).toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fällt nie aus: fehlendes Zielverzeichnis, fehlende session_id, Müll-Eingabe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    expect(() => run(FULL, '/nonexistent/pfad')).not.toThrow();
    // ohne session_id bleibt der Briefkasten LEER statt eine globale Datei zu schreiben
    run(JSON.stringify({ context_window: { used_percentage: 5 } }), dir);
    expect(readdirSync(dir).filter((f) => f.startsWith('status'))).toHaveLength(0);
    expect(() => run('kein-json{{{', dir)).not.toThrow();
    // keine halben Dateien: die temporäre Ablage wird immer aufgeräumt
    expect(readdirSync(dir).filter((f) => f.startsWith('.status.'))).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('readStatus', () => {
  it('markiert veraltete Stände statt sie unmarkiert weiterzuzeigen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'status-x.json');
    writeFileSync(p, JSON.stringify({ ts: 1000, context: { used_percentage: 10 } }));
    expect(readStatus(p, 1000 + STALE_AFTER_SECONDS - 1).stale).toBe(false);
    expect(readStatus(p, 1000 + STALE_AFTER_SECONDS + 1).stale).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('macht aus fehlenden Feldern null, nicht 0', () => {
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

describe('Collector mit Briefkasten', () => {
  it('meldet den fehlenden Briefkasten als wartende Quelle, statt zu werfen', async () => {
    const c = new Collector({
      eventsPath: '/nonexistent/e.jsonl',
      rules,
      skipAgents: true,
      statusPath: '/nonexistent/status.json',
    });
    const state = await c.poll();
    expect(state.status).toBeNull();
    expect(state.errors.some((e) => e.source === 'status' && e.reason.includes('wartet'))).toBe(true);
  });

  it('reicht einen vorhandenen Stand durch', async () => {
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

describe('Darstellung', () => {
  it('untilReset rechnet in Stunden, Minuten und Tage', () => {
    expect(untilReset(1000 + 45 * 60, 1000)).toBe('noch 45 min');
    expect(untilReset(1000 + 2 * 3600 + 15 * 60, 1000)).toBe('noch 2 h 15 min');
    expect(untilReset(1000 + 50 * 3600, 1000)).toBe('noch 2 d 2 h');
    expect(untilReset(500, 1000)).toBe('zurückgesetzt');
    expect(untilReset(null, 1000)).toBe('');
  });

  it('bar bleibt immer gleich breit und wird bei Ausreissern nicht laenger', () => {
    expect(bar(0, 10)).toBe('░'.repeat(10));
    expect(bar(100, 10)).toBe('█'.repeat(10));
    expect(bar(50, 10)).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(bar(-5, 10)).toHaveLength(10);
    expect(bar(999, 10)).toBe('█'.repeat(10));
  });

  it('pctColor schaltet bei 50 und 75 um — wie die Statuszeile', () => {
    expect(pctColor(49)).toBe('green');
    expect(pctColor(50)).toBe('yellow');
    expect(pctColor(74)).toBe('yellow');
    expect(pctColor(75)).toBe('red');
  });
});

/** Die Rohdatei bleibt lesbar — Regression gegen ein kaputtes jq-Filter. */
describe('Briefkasten-Format', () => {
  it('ist genau eine Zeile gültiges JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    run(FULL, dir);
    const raw = readFileSync(join(dir, 'status-s1.json'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(raw)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
