import { describe, it, expect, vi } from 'vitest';
import { parseKey, KeySequencer, type KeyAction } from '../src/keyboard.js';
import { osc8 } from '../src/osc8.js';

describe('parseKey', () => {
  it('parses focus sequences', () => {
    expect(parseKey('\x1bck3')).toEqual({ type: 'focus', card: 3 });
  });
  it('parses arrows/enter/escape', () => {
    expect(parseKey('\x1b[A')).toEqual({ type: 'up' });
    expect(parseKey('\x1b[B')).toEqual({ type: 'down' });
    expect(parseKey('\x1b[C')).toEqual({ type: 'right' });
    expect(parseKey('\x1b[D')).toEqual({ type: 'left' });
    expect(parseKey('\r')).toEqual({ type: 'enter' });
    expect(parseKey('\x1b')).toEqual({ type: 'escape' });
    expect(parseKey('q')).toEqual({ type: 'quit' });
  });
  it('reicht druckbare Zeichen als text-Aktion durch', () => {
    // Seit 2026-08-04: der tmux-Fokus liegt während der Kartenbedienung auf
    // dem Dashboard. Wer danach weitertippt, meinte Claude — die App gibt den
    // Fokus zurück und reicht das Zeichen hinüber, statt es zu verschlucken.
    expect(parseKey('x')).toEqual({ type: 'text', text: 'x' });
    expect(parseKey(' ')).toEqual({ type: 'text', text: ' ' });
    expect(parseKey('ä')).toEqual({ type: 'text', text: 'ä' });
    expect(parseKey('7')).toEqual({ type: 'text', text: '7' });
  });

  it('reicht STEUERZEICHEN nicht durch — die könnten links etwas auslösen', () => {
    expect(parseKey('\t')).toBeNull();
    expect(parseKey('\x03')).toBeNull(); // Strg-C
    expect(parseKey('\x7f')).toBeNull(); // Löschtaste
    expect(parseKey('\x1b[Z')).toBeNull(); // unbekannte Escape-Sequenz
  });

  it('behandelt q weiterhin als Beenden — die Karten-Ausnahme liegt in der App', () => {
    // parseKey bleibt kontextfrei und damit prüfbar; ob 'q' bei gewählter
    // Karte als Text gilt, entscheidet app.tsx anhand des Fokus.
    expect(parseKey('q')).toEqual({ type: 'quit' });
  });
});

describe('KeySequencer', () => {
  it('assembles focus sequence from split chunks', () => {
    vi.useFakeTimers();
    const seen: KeyAction[] = [];
    const ks = new KeySequencer((a) => seen.push(a));
    ks.push('\x1b');
    ks.push('c');
    ks.push('k');
    ks.push('3');
    vi.runAllTimers();
    expect(seen).toEqual([{ type: 'focus', card: 3 }]);
    vi.useRealTimers();
  });
  it('emits escape when lone ESC times out', () => {
    vi.useFakeTimers();
    const seen: KeyAction[] = [];
    const ks = new KeySequencer((a) => seen.push(a));
    ks.push('\x1b');
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([{ type: 'escape' }]);
    vi.useRealTimers();
  });
  it('passes plain keys through immediately', () => {
    const seen: KeyAction[] = [];
    const ks = new KeySequencer((a) => seen.push(a));
    ks.push('\r');
    ks.push('q');
    expect(seen).toEqual([{ type: 'enter' }, { type: 'quit' }]);
  });
});

describe('osc8', () => {
  it('wraps label in OSC-8 hyperlink', () => {
    expect(osc8('https://x.dev', 'X')).toBe('\x1b]8;;https://x.dev\x1b\\X\x1b]8;;\x1b\\');
  });
});
