import type { CockpitState, CardId, FileItem } from '../types.js';

/**
 * Anzeigereihenfolge der Dateikarte: Kandidaten (★) zuerst, innerhalb einer
 * Gruppe die juengsten oben.
 *
 * EINE Quelle fuer zwei Verbraucher — die Karte zeichnet danach, und die
 * Enter-Taste waehlt danach aus. Bis 2026-08-04 stand dieselbe Sortierung
 * zweimal im Code (Files.tsx und app.tsx). Waeren die auseinandergelaufen,
 * haette Enter eine ANDERE Datei geoeffnet als die markierte — ein Fehler,
 * der sich erst beim Klick zeigt und nach einem Zufall aussieht.
 */
export function sortFiles(files: FileItem[]): FileItem[] {
  return [...files].sort((a, b) =>
    a.origin === b.origin ? b.ts - a.ts : a.origin === 'candidate' ? -1 : 1,
  );
}

/** Was die Enter-Taste oeffnen soll — oder null, wenn nichts zu oeffnen ist. */
export type OpenTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; app?: string };

/**
 * Entscheidet REIN rechnend, was Enter auf einer Karte oeffnet. Ohne
 * Seiteneffekt, damit genau diese Auswahl pruefbar ist; das eigentliche
 * Oeffnen (execFile) bleibt in der App.
 *
 * Die Plugin-Karte ist bewusst NICHT hier: sie oeffnet nichts, sondern
 * schaltet eine Aktionsleiste und aendert Zustand.
 */
export function resolveOpenTarget(
  card: CardId,
  state: CockpitState,
  cursor: number,
): OpenTarget | null {
  if (card === 'links') {
    const l = state.links[cursor];
    // Nur echte http(s)-Ziele. Ein Link aus fremdem Text ist untrusted
    // content — file:// oder gar javascript: gehoeren nicht an `open`.
    return l && /^https?:\/\//.test(l.url) ? { kind: 'url', url: l.url } : null;
  }
  if (card === 'files') {
    const f = sortFiles(state.files)[cursor];
    if (!f || !f.path.startsWith('/')) return null;
    return f.path.endsWith('.md')
      ? { kind: 'file', path: f.path, app: 'MD Viewer' }
      : { kind: 'file', path: f.path };
  }
  return null;
}

/** Argumentliste fuer `open`, passend zum Ziel. */
export function openArgs(t: OpenTarget): string[] {
  if (t.kind === 'url') return [t.url];
  return t.app !== undefined ? ['-a', t.app, t.path] : [t.path];
}
