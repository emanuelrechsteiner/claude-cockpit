import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
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
});
