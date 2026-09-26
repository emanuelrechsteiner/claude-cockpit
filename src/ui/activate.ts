import type { CockpitState, CardId, FileItem } from '../types.js';

/**
 * Display order of the Files card: candidates (★) first, newest on top
 * within each group.
 *
 * ONE source for two consumers — the card renders by it, and the Enter key
 * selects by it. Until 2026-08-04, the same sort lived twice in the code
 * (Files.tsx and app.tsx). Had they drifted apart, Enter would have opened a
 * DIFFERENT file than the one highlighted — a bug that only shows up on
 * click and looks like a fluke.
 */
export function sortFiles(files: FileItem[]): FileItem[] {
  return [...files].sort((a, b) =>
    a.origin === b.origin ? b.ts - a.ts : a.origin === 'candidate' ? -1 : 1,
  );
}

/** What the Enter key should open — or null when there is nothing to open. */
export type OpenTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; app?: string };

/**
 * Decides PURELY by computation what Enter opens on a card. No side effect,
 * so exactly this choice is testable; the actual opening (execFile) stays in
 * the app.
 *
 * The Plugins card is deliberately NOT here: it doesn't open anything, it
 * toggles an action bar and changes state.
 */
export function resolveOpenTarget(
  card: CardId,
  state: CockpitState,
  cursor: number,
): OpenTarget | null {
  if (card === 'links') {
    const l = state.links[cursor];
    // Only real http(s) targets. A link from foreign text is untrusted
    // content — file:// or even javascript: has no business going to `open`.
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

/** Argument list for `open`, matching the target. */
export function openArgs(t: OpenTarget): string[] {
  if (t.kind === 'url') return [t.url];
  return t.app !== undefined ? ['-a', t.app, t.path] : [t.path];
}
