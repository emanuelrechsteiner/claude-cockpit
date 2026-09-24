import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cockpit-event.sh', () => {
  it('appends one JSONL line and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const input = JSON.stringify({ session_id: 'test123', tool_name: 'Task' });
    execFileSync('bash', ['hooks/cockpit-event.sh', 'SubagentStart'], {
      input,
      env: { ...process.env, COCKPIT_DIR: dir },
    });
    const line = readFileSync(join(dir, 'events-test123.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(line) as { ts: number; event: string; data: { session_id: string } };
    expect(parsed.event).toBe('SubagentStart');
    expect(parsed.data.session_id).toBe('test123');
    expect(parsed.ts).toBeTypeOf('number');
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 even on garbage input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    execFileSync('bash', ['hooks/cockpit-event.sh', 'X'], {
      input: 'not-json',
      env: { ...process.env, COCKPIT_DIR: dir },
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
