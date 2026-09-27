import { describe, it, expect, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = 'hooks/cockpit-event.sh';
const SID = 'test123';
const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
  dirs.push(dir);
  return dir;
}

function run(dir: string, event: string, payload: unknown): void {
  execFileSync('bash', [HOOK, event], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, COCKPIT_DIR: dir },
  });
}

function runAsync(dir: string, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile('bash', [HOOK, event], { env: { ...process.env, COCKPIT_DIR: dir } }, (err) =>
      err ? reject(err) : resolve(undefined),
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

interface Line {
  ts: number;
  event: string;
  data: Record<string, unknown> | null;
}

function lines(dir: string, sid = SID): string[] {
  return readFileSync(join(dir, `events-${sid}.jsonl`), 'utf8').split('\n').filter((l) => l !== '');
}

function only(dir: string): Line {
  const all = lines(dir);
  expect(all).toHaveLength(1);
  return JSON.parse(all[0]) as Line;
}

// Field SHAPES copied from a real events file (2026-09-27), content synthetic.
const common = {
  session_id: SID,
  transcript_path: '/anderswo/fremd/.claude/projects/-proj/abc.jsonl',
  cwd: '/anderswo/fremd/cockpit',
  permission_mode: 'bypassPermissions',
  prompt_id: 'p-1',
  scratchpad_dir: '/tmp/scratch',
  effort: { level: 'high' },
};
const umlaut = (n: number): string => 'Größenänderung überprüfen '.repeat(n);
const shapes: Record<string, Record<string, unknown>> = {
  SubagentStart: { ...common, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_1',
    tool_input: { subagent_type: 'backend-agent', description: umlaut(15), model: 'sonnet', prompt: 'x'.repeat(60_000) } },
  SubagentStop: { ...common, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'backend-agent',
    agent_transcript_path: '/tmp/a1.jsonl', background_tasks: [{ id: 1 }], session_crons: [], stop_hook_active: false,
    last_assistant_message: umlaut(200) },
  TaskCreated: { ...common, hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_use_id: 'toolu_2', duration_ms: 3,
    tool_input: { subject: umlaut(12), description: umlaut(20), activeForm: umlaut(5) },
    tool_response: { task: { id: '7', subject: umlaut(12) } } },
  TaskUpdated: { ...common, hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_use_id: 'toolu_3', duration_ms: 2,
    tool_input: { taskId: '7', status: 'completed', description: umlaut(20) },
    tool_response: { success: true, taskId: '7', updatedFields: ['status'], statusChange: { from: 'in_progress', to: 'completed' } } },
  FileWrite: { ...common, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'toolu_4', agent_id: 'a1',
    agent_type: 'backend-agent', tool_input: { file_path: '/p/src/a.ts', old_string: 'a'.repeat(30_000), new_string: 'b'.repeat(30_000) },
    tool_response: { filePath: '/p/src/a.ts', originalFile: 'c'.repeat(90_000), structuredPatch: [{ lines: ['x'] }] } },
  SessionEnd: { ...common, hook_event_name: 'SessionEnd', last_assistant_message: umlaut(200), background_tasks: [] },
  SessionStart: { session_id: SID, transcript_path: common.transcript_path, cwd: common.cwd,
    hook_event_name: 'SessionStart', source: 'resume', scratchpad_dir: '/tmp/s' },
};

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('cockpit-event.sh', () => {
  it('appends one JSONL line and exits 0', () => {
    const dir = freshDir();
    run(dir, 'SubagentStart', { session_id: SID, tool_name: 'Task' });
    const parsed = only(dir);
    expect(parsed.event).toBe('SubagentStart');
    expect(parsed.data?.['session_id']).toBe(SID);
    expect(parsed.ts).toBeTypeOf('number');
  });

  it('exits 0 on garbage input and appends a data:null line', () => {
    const dir = freshDir();
    run(dir, 'X', 'not-json');
    const all = lines(dir, 'unknown');
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0])).toMatchObject({ event: 'X', data: null });
  }, 10_000);

  it('24 parallel TaskUpdated invocations yield 24 intact lines', async () => {
    const dir = freshDir();
    const ids = Array.from({ length: 24 }, (_, i) => `task-${i}`);
    await Promise.all(ids.map((taskId) => runAsync(dir, 'TaskUpdated', {
      // 20 KB of payload: the old untrimmed hook interleaved lines of this size.
      ...shapes['TaskUpdated'], tool_input: { taskId, status: 'completed', description: 'x'.repeat(20_000) },
    })));
    const all = lines(dir);
    expect(all).toHaveLength(24);
    const seen = all.map((l) => ((JSON.parse(l) as Line).data?.['tool_input'] as { taskId: string }).taskId);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(existsSync(join(dir, `.lock-${SID}`))).toBe(false);
  }, 30_000);

  it('drops a 200 KB tool_response and keeps tool_input.file_path', () => {
    const dir = freshDir();
    run(dir, 'FileWrite', { ...common, hook_event_name: 'PostToolUse', tool_name: 'Write',
      tool_input: { file_path: '/p/big.ts', content: 'y'.repeat(200_000) },
      tool_response: { type: 'create', filePath: '/p/big.ts', content: 'z'.repeat(200_000) } });
    const raw = lines(dir)[0];
    expect(Buffer.byteLength(raw)).toBeLessThan(2048);
    const data = (JSON.parse(raw) as Line).data ?? {};
    expect(data['tool_input']).toEqual({ file_path: '/p/big.ts' });
    expect(data['tool_name']).toBe('Write');
    expect(data['tool_response']).toBeUndefined();
    expect(data['transcript_path']).toBeUndefined();
  });

  it.each(Object.keys(shapes))('keeps every real %s shape under 2,048 bytes', (event) => {
    const dir = freshDir();
    run(dir, event, shapes[event]);
    const raw = lines(dir)[0];
    expect(Buffer.byteLength(raw)).toBeLessThan(2048);
    expect(JSON.parse(raw)).toMatchObject({ event, data: { session_id: SID } });
  });

  it('keeps exactly the reducer fields on TaskCreated/TaskUpdated', () => {
    const dir = freshDir();
    run(dir, 'TaskCreated', shapes['TaskCreated']);
    run(dir, 'TaskUpdated', shapes['TaskUpdated']);
    const [created, updated] = lines(dir).map((l) => (JSON.parse(l) as Line).data ?? {});
    expect(created['tool_response']).toEqual({ task: { id: '7', subject: umlaut(12).slice(0, 300) } });
    expect(Object.keys(created['tool_input'] as object)).toEqual(['description', 'subject']);
    expect(updated['tool_response']).toEqual({ taskId: '7' });
    expect(updated['tool_input']).toMatchObject({ taskId: '7', status: 'completed' });
  });

  it('SubagentStop keeps agent_type "" and truncates last_assistant_message', () => {
    const dir = freshDir();
    run(dir, 'SubagentStop', { ...shapes['SubagentStop'], agent_type: '', last_assistant_message: 'm'.repeat(5000) });
    const data = only(dir).data ?? {};
    expect(data['agent_type']).toBe('');
    expect(data['agent_id']).toBe('a1');
    expect(data['last_assistant_message']).toBe('m'.repeat(300));
    expect(data['background_tasks']).toBeUndefined();
  });

  it('SubagentStart keeps type, description, model and effort level', () => {
    const dir = freshDir();
    run(dir, 'SubagentStart', { ...shapes['SubagentStart'], tool_input: { subagent_type: 'ui-agent', description: 'd', model: 'opus', prompt: 'p' } });
    const data = only(dir).data ?? {};
    expect(data).toMatchObject({ tool_use_id: 'toolu_1', effort: { level: 'high' }, cwd: common.cwd });
    expect(data['tool_input']).toEqual({ subagent_type: 'ui-agent', description: 'd', model: 'opus' });
  });

  it('SessionStart writes session-<sid>.json and current-session.json', () => {
    const dir = freshDir();
    run(dir, 'SessionStart', shapes['SessionStart']);
    const want = { session_id: SID, transcript_path: common.transcript_path, cwd: common.cwd };
    expect(JSON.parse(readFileSync(join(dir, `session-${SID}.json`), 'utf8'))).toEqual(want);
    expect(JSON.parse(readFileSync(join(dir, 'current-session.json'), 'utf8'))).toEqual(want);
    expect(only(dir).data).toMatchObject({ source: 'resume', transcript_path: common.transcript_path });
  });

  it('unknown events keep only session_id and hook_event_name', () => {
    const dir = freshDir();
    run(dir, 'SessionEnd', shapes['SessionEnd']);
    expect(only(dir).data).toEqual({ session_id: SID, hook_event_name: 'SessionEnd' });
  });

  it('a stale lock delays at most ~1 s, is logged, removed, and the line is still written', () => {
    const dir = freshDir();
    mkdirSync(join(dir, `.lock-${SID}`));
    const started = Date.now();
    run(dir, 'TaskUpdated', shapes['TaskUpdated']);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(lines(dir)).toHaveLength(1);
    expect(readFileSync(join(dir, 'errors.log'), 'utf8')).toContain('lock timeout');
    expect(existsSync(join(dir, `.lock-${SID}`))).toBe(false);
  }, 10_000);

  it('a session id carrying a path falls back to "unknown"', () => {
    const dir = freshDir();
    run(dir, 'TaskUpdated', { ...shapes['TaskUpdated'], session_id: '../escape' });
    expect(lines(dir, 'unknown')).toHaveLength(1);
  });
});
