export type KeyAction =
  | { type: 'focus'; card: number }
  | { type: 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'quit' }
  /**
   * An ordinary printable character. Since 2026-08-04, tmux focus sits on the
   * dashboard while operating a card — whoever keeps typing after that meant
   * Claude. The app returns focus and forwards the character instead of
   * swallowing it.
   */
  | { type: 'text'; text: string };

const ESC = '\x1b';

export function parseKey(chunk: string): KeyAction | null {
  const focus = new RegExp(`^${ESC}ck([1-7])$`).exec(chunk);
  if (focus) return { type: 'focus', card: Number(focus[1]) };
  if (chunk === `${ESC}[A`) return { type: 'up' };
  if (chunk === `${ESC}[B`) return { type: 'down' };
  if (chunk === `${ESC}[C`) return { type: 'right' };
  if (chunk === `${ESC}[D`) return { type: 'left' };
  if (chunk === '\r' || chunk === '\n') return { type: 'enter' };
  if (chunk === ESC) return { type: 'escape' };
  if (chunk === 'q') return { type: 'quit' };
  if (isPrintable(chunk)) return { type: 'text', text: chunk };
  return null;
}

/**
 * Printable = a single character from space upward, excluding delete.
 * Control characters (tab, ctrl combinations) are deliberately NOT forwarded:
 * they could trigger something on the left the user didn't intend.
 */
function isPrintable(chunk: string): boolean {
  if ([...chunk].length !== 1) return false;
  const code = chunk.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

/**
 * Reassembles sequences that tmux/send-keys forwards as individual
 * characters. If a chunk starts with ESC, it is buffered for up to 50 ms; if
 * the buffer forms a known sequence, it is emitted — otherwise, after a
 * timeout, a plain Escape (or it is discarded).
 */
export class KeySequencer {
  private buf = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private emit: (a: KeyAction) => void, private timeoutMs = 50) {}

  push(chunk: string): void {
    if (this.buf === '' && !chunk.startsWith(ESC)) {
      const a = parseKey(chunk);
      if (a) this.emit(a);
      return;
    }
    this.buf += chunk;
    const complete = parseKey(this.buf);
    if (complete && this.buf !== ESC) {
      this.clear();
      this.emit(complete);
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.timeoutMs);
    }
  }

  private flush(): void {
    const a = parseKey(this.buf);
    this.clear();
    if (a) this.emit(a);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buf = '';
  }
}
