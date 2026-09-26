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
};

const f = (path: string, origin: FileItem['origin'], ts: number): FileItem => ({ path, origin, ts });

describe('sortFiles', () => {
  it('stellt Kandidaten voran, innerhalb der Gruppe die jüngsten zuerst', () => {
    const sorted = sortFiles([
      f('/a/alt.ts', 'written', 100),
      f('/a/neu.ts', 'written', 300),
      f('/a/kandidat-alt.md', 'candidate', 100),
      f('/a/kandidat-neu.md', 'candidate', 200),
    ]);
    expect(sorted.map((x) => x.path)).toEqual([
      '/a/kandidat-neu.md',
      '/a/kandidat-alt.md',
      '/a/neu.ts',
      '/a/alt.ts',
    ]);
  });

  it('lässt die Eingabe unangetastet (kein In-Place-Sortieren)', () => {
    const input = [f('/a/b.ts', 'written', 1), f('/a/a.md', 'candidate', 2)];
    const copy = [...input];
    sortFiles(input);
    expect(input).toEqual(copy);
  });
});

describe('resolveOpenTarget — Dateikarte', () => {
  // DER Fall, den die frühere Doppelung der Sortierung verdeckt hätte:
  // die Karte zeigt sortiert, Enter wählte über denselben Index. Liefen die
  // beiden Sortierungen auseinander, öffnete Enter eine ANDERE Datei.
  it('wählt über denselben Index, den die Karte anzeigt', () => {
    const state: CockpitState = {
      ...empty,
      files: [f('/p/zuletzt.ts', 'written', 900), f('/p/wichtig.md', 'candidate', 100)],
    };
    // Angezeigt an Position 0 ist der Kandidat, nicht die jüngste Datei.
    expect(sortFiles(state.files)[0].path).toBe('/p/wichtig.md');
    expect(resolveOpenTarget('files', state, 0)).toEqual({
      kind: 'file',
      path: '/p/wichtig.md',
      app: 'MD Viewer',
    });
    expect(resolveOpenTarget('files', state, 1)).toEqual({ kind: 'file', path: '/p/zuletzt.ts' });
  });

  it('öffnet Markdown mit dem MD Viewer, alles andere ohne App-Angabe', () => {
    const md: CockpitState = { ...empty, files: [f('/p/x.md', 'written', 1)] };
    const ts: CockpitState = { ...empty, files: [f('/p/x.ts', 'written', 1)] };
    expect(resolveOpenTarget('files', md, 0)).toEqual({
      kind: 'file',
      path: '/p/x.md',
      app: 'MD Viewer',
    });
    expect(resolveOpenTarget('files', ts, 0)).toEqual({ kind: 'file', path: '/p/x.ts' });
  });

  it('weist relative Pfade und Leerauswahl zurück', () => {
    const rel: CockpitState = { ...empty, files: [f('relativ.ts', 'written', 1)] };
    expect(resolveOpenTarget('files', rel, 0)).toBeNull();
    expect(resolveOpenTarget('files', empty, 0)).toBeNull();
    expect(resolveOpenTarget('files', rel, 99)).toBeNull();
  });
});

describe('resolveOpenTarget — Linkkarte', () => {
  it('öffnet http und https', () => {
    const s: CockpitState = {
      ...empty,
      links: [{ url: 'https://example.test/a', kind: 'source', label: 'a', ts: 1 }],
    };
    expect(resolveOpenTarget('links', s, 0)).toEqual({ kind: 'url', url: 'https://example.test/a' });
  });

  it('weist alles zurück, was kein http(s) ist — Links sind fremder Text', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.test', '/lokal/pfad']) {
      const s: CockpitState = { ...empty, links: [{ url, kind: 'source', label: 'x', ts: 1 }] };
      expect(resolveOpenTarget('links', s, 0)).toBeNull();
    }
  });
});

describe('resolveOpenTarget — übrige Karten öffnen nichts', () => {
  it('gibt für teamlead/subagents/workflows/plugins null zurück', () => {
    for (const card of ['teamlead', 'subagents', 'workflows', 'plugins'] as const) {
      expect(resolveOpenTarget(card, empty, 0)).toBeNull();
    }
  });
});

describe('openArgs', () => {
  it('baut die Argumentliste für open', () => {
    expect(openArgs({ kind: 'url', url: 'https://x.test' })).toEqual(['https://x.test']);
    expect(openArgs({ kind: 'file', path: '/p/x.ts' })).toEqual(['/p/x.ts']);
    expect(openArgs({ kind: 'file', path: '/p/x.md', app: 'MD Viewer' })).toEqual([
      '-a',
      'MD Viewer',
      '/p/x.md',
    ]);
  });
});
