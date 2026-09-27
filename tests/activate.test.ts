import { describe, it, expect } from 'vitest';
import { sortFiles, resolveOpenTarget, openArgs } from '../src/ui/activate.js';
import type { CockpitState, FileItem } from '../src/types.js';

const empty: CockpitState = {
  teamLead: { state: 'idle', step: '', model: '', contextPct: 0 },
  status: null,
  subagents: [],
  liveAgents: null,
  agentDefs: new Map(),
  workflows: [],
  links: [],
  files: [],
  plugins: [],
  errors: [],
  freshness: { eventsMs: null, statusMs: null, liveMs: null },
};

const f = (path: string, origin: FileItem['origin'], ts: number): FileItem => ({ path, origin, ts });

describe('sortFiles', () => {
  it('puts candidates first, newest first within each group', () => {
    const sorted = sortFiles([
      f('/a/old.ts', 'written', 100),
      f('/a/new.ts', 'written', 300),
      f('/a/candidate-old.md', 'candidate', 100),
      f('/a/candidate-new.md', 'candidate', 200),
    ]);
    expect(sorted.map((x) => x.path)).toEqual([
      '/a/candidate-new.md',
      '/a/candidate-old.md',
      '/a/new.ts',
      '/a/old.ts',
    ]);
  });

  it('leaves the input untouched (no in-place sorting)', () => {
    const input = [f('/a/b.ts', 'written', 1), f('/a/a.md', 'candidate', 2)];
    const copy = [...input];
    sortFiles(input);
    expect(input).toEqual(copy);
  });
});

describe('resolveOpenTarget — Files card', () => {
  // THE case that the earlier duplication of the sort would have hidden: the
  // card displays sorted, Enter selected by the same index. If the two sorts
  // had drifted apart, Enter would have opened a DIFFERENT file.
  it('selects by the same index the card displays', () => {
    const state: CockpitState = {
      ...empty,
      files: [f('/p/latest.ts', 'written', 900), f('/p/important.md', 'candidate', 100)],
    };
    // Displayed at position 0 is the candidate, not the newest file.
    expect(sortFiles(state.files)[0].path).toBe('/p/important.md');
    expect(resolveOpenTarget('files', state, 0)).toEqual({
      kind: 'file',
      path: '/p/important.md',
      app: 'MD Viewer',
    });
    expect(resolveOpenTarget('files', state, 1)).toEqual({ kind: 'file', path: '/p/latest.ts' });
  });

  it('opens markdown with the MD Viewer, everything else without an app', () => {
    const md: CockpitState = { ...empty, files: [f('/p/x.md', 'written', 1)] };
    const ts: CockpitState = { ...empty, files: [f('/p/x.ts', 'written', 1)] };
    expect(resolveOpenTarget('files', md, 0)).toEqual({
      kind: 'file',
      path: '/p/x.md',
      app: 'MD Viewer',
    });
    expect(resolveOpenTarget('files', ts, 0)).toEqual({ kind: 'file', path: '/p/x.ts' });
  });

  it('rejects relative paths and an empty selection', () => {
    const rel: CockpitState = { ...empty, files: [f('relative.ts', 'written', 1)] };
    expect(resolveOpenTarget('files', rel, 0)).toBeNull();
    expect(resolveOpenTarget('files', empty, 0)).toBeNull();
    expect(resolveOpenTarget('files', rel, 99)).toBeNull();
  });
});

describe('resolveOpenTarget — Links card', () => {
  it('opens http and https', () => {
    const s: CockpitState = {
      ...empty,
      links: [{ url: 'https://example.test/a', kind: 'source', label: 'a', ts: 1 }],
    };
    expect(resolveOpenTarget('links', s, 0)).toEqual({ kind: 'url', url: 'https://example.test/a' });
  });

  it('rejects everything that is not http(s) — links are foreign text', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.test', '/local/path']) {
      const s: CockpitState = { ...empty, links: [{ url, kind: 'source', label: 'x', ts: 1 }] };
      expect(resolveOpenTarget('links', s, 0)).toBeNull();
    }
  });
});

describe('resolveOpenTarget — other cards open nothing', () => {
  it('returns null for teamlead/subagents/workflows/plugins', () => {
    for (const card of ['teamlead', 'subagents', 'workflows', 'plugins'] as const) {
      expect(resolveOpenTarget(card, empty, 0)).toBeNull();
    }
  });
});

describe('openArgs', () => {
  it('builds the argument list for open', () => {
    expect(openArgs({ kind: 'url', url: 'https://x.test' })).toEqual(['https://x.test']);
    expect(openArgs({ kind: 'file', path: '/p/x.ts' })).toEqual(['/p/x.ts']);
    expect(openArgs({ kind: 'file', path: '/p/x.md', app: 'MD Viewer' })).toEqual([
      '-a',
      'MD Viewer',
      '/p/x.md',
    ]);
  });
});
