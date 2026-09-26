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
  it('forwards printable characters as a text action', () => {
    // Since 2026-08-04: tmux focus sits on the dashboard while operating a
    // card. Whoever keeps typing after that meant Claude — the app returns
    // focus and forwards the character instead of swallowing it.
    expect(parseKey('x')).toEqual({ type: 'text', text: 'x' });
    expect(parseKey(' ')).toEqual({ type: 'text', text: ' ' });
    expect(parseKey('ä')).toEqual({ type: 'text', text: 'ä' });
    expect(parseKey('7')).toEqual({ type: 'text', text: '7' });
  });

  it('does not forward CONTROL CHARACTERS — those could trigger something on the left', () => {
    expect(parseKey('\t')).toBeNull();
    expect(parseKey('\x03')).toBeNull(); // Ctrl-C
    expect(parseKey('\x7f')).toBeNull(); // delete key
    expect(parseKey('\x1b[Z')).toBeNull(); // unknown escape sequence
  });

  it('still treats q as quit — the card exception lives in the app', () => {
    // parseKey stays context-free and therefore testable; whether 'q' counts
    // as text while a card is selected is decided by app.tsx based on focus.
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
