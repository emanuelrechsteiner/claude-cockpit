import { describe, it, expect } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscriptLines, readNewLines } from '../src/parse/transcript.js';
import { loadRules } from '../src/rules.js';

const rules = loadRules(new URL('../config/rules.json', import.meta.url).pathname);
const lines = readFileSync(new URL('./fixtures/transcript-sample.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n');

describe('parseTranscriptLines', () => {
  const { links, files } = parseTranscriptLines(lines, rules);
  it('extracts preview + source links from assistant text only', () => {
    expect(links.map((l) => l.kind).sort()).toEqual(['preview', 'source']);
  });
  it('collects written files; candidates flagged', () => {
    expect(files.find((f) => f.path.endsWith('CLAUDE.md'))?.origin).toBe('candidate');
    expect(files.find((f) => f.path.endsWith('util.ts'))?.origin).toBe('written');
  });
  it('ignores user-message urls', () => {
    expect(links.some((l) => l.url.includes('evil'))).toBe(false);
  });
});

describe('readNewLines', () => {
  it('reads incrementally by byte offset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'f.jsonl');
    writeFileSync(p, 'a\nb\n');
    const first = readNewLines(p, 0);
    expect(first.lines).toEqual(['a', 'b']);
    writeFileSync(p, 'a\nb\nc\n');
    const second = readNewLines(p, first.newOffset);
    expect(second.lines).toEqual(['c']);
  });

  it('keeps a byte offset with multibyte UTF-8: no re-read without growth, then exactly the appended line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'f.jsonl');
    const body = 'eins — zwei\nÄrger ä ö ü\nemoji 🚀🎉 done\n';
    writeFileSync(p, body);
    const first = readNewLines(p, 0);
    expect(first.lines).toEqual(['eins — zwei', 'Ärger ä ö ü', 'emoji 🚀🎉 done']);
    expect(first.newOffset).toBe(Buffer.byteLength(body));
    const again = readNewLines(p, first.newOffset);
    expect(again).toEqual({ lines: [], newOffset: first.newOffset, size: first.newOffset });
    appendFileSync(p, 'next — 🧪\n');
    const third = readNewLines(p, again.newOffset);
    expect(third.lines).toEqual(['next — 🧪']);
    expect(readNewLines(p, third.newOffset).lines).toEqual([]);
  });

  it('holds back a line cut mid-multibyte-character at EOF and delivers it once complete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const p = join(dir, 'f.jsonl');
    const tail = Buffer.from('half 🚀 line\n');
    const cut = tail.indexOf(Buffer.from('🚀')) + 2; // inside the 4-byte emoji
    writeFileSync(p, Buffer.concat([Buffer.from('ä first\n'), tail.subarray(0, cut)]));
    const first = readNewLines(p, 0);
    expect(first.lines).toEqual(['ä first']);
    expect(first.newOffset).toBe(Buffer.byteLength('ä first\n'));
    expect(readNewLines(p, first.newOffset)).toMatchObject({ lines: [], newOffset: first.newOffset });
    appendFileSync(p, tail.subarray(cut));
    const second = readNewLines(p, first.newOffset);
    expect(second.lines).toEqual(['half 🚀 line']);
    expect(readNewLines(p, second.newOffset).lines).toEqual([]);
  });
});

describe('parseTranscriptLines — Agent dispatch outcomes', () => {
  // Entry shapes from the real parent transcript 59977e20…jsonl.
  const call = (id: string, name: string) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
  const result = (id: string, toolUseResult: unknown, isError?: boolean) =>
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, ...(isError ? { is_error: true } : {}), content: 'x' }] },
      toolUseResult,
    });

  it('maps background, synchronous and denied Agent/Task results; ignores other tools', () => {
    const { dispatches } = parseTranscriptLines(
      [
        call('toolu_bg', 'Agent'),
        call('toolu_sync', 'Task'),
        call('toolu_denied', 'Agent'),
        call('toolu_bash', 'Bash'),
        result('toolu_bg', { agentId: 'a1', status: 'async_launched' }),
        result('toolu_sync', { agentId: 'a2', status: 'completed', totalDurationMs: 5 }),
        result('toolu_denied', 'Error: Permission for this action was denied by the Claude Code auto mode classifier.', true),
        // A non-Agent result, even one carrying an agentId-shaped field, is not a dispatch.
        result('toolu_bash', { agentId: 'nope', stdout: '' }),
        result('toolu_unknown', { agentId: 'nope2' }),
      ],
      rules,
    );
    expect(dispatches).toEqual([
      { toolUseId: 'toolu_bg', agentId: 'a1', denied: false },
      { toolUseId: 'toolu_sync', agentId: 'a2', denied: false },
      { toolUseId: 'toolu_denied', agentId: null, denied: true },
    ]);
  });

  it('remembers Agent calls across polls through the passed-in set', () => {
    const calls = new Set<string>();
    expect(parseTranscriptLines([call('toolu_1', 'Agent')], rules, calls).dispatches).toEqual([]);
    expect(parseTranscriptLines([result('toolu_1', { agentId: 'a9' })], rules, calls).dispatches).toEqual([
      { toolUseId: 'toolu_1', agentId: 'a9', denied: false },
    ]);
    // Without the carried set the same result is not recognised as a dispatch.
    expect(parseTranscriptLines([result('toolu_1', { agentId: 'a9' })], rules).dispatches).toEqual([]);
  });
});
