/**
 * Reading hook-event lines that concurrent writers garbled. Two hook runs can
 * interleave their appends: writer A writes the head of its record, writer B
 * writes a whole record plus newline, then A writes its tail plus newline.
 * Real case, events-59977e20…jsonl lines 571–572: task 11's TaskUpdated cut
 * off after `"to":"completed"`, task 12's complete TaskUpdated glued on, and
 * task 11's tail `}},"tool_use_id":…}}` alone on the next line.
 *
 * Pure functions: no I/O, no state beyond what is passed in and returned.
 */

export interface EventLine {
  ts: number;
  event: string;
  data: Record<string, unknown> | null;
}

/** Every event object starts with `{"ts":` (the hook writes `ts` first). */
export const EVENT_START = '{"ts":';

/**
 * Text → event, or null when it is not JSON or not an event object (needs a
 * numeric `ts` and a string `event`). The caller decides how to count a null.
 */
export function parseEvent(text: string): EventLine | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // Not JSON: null tells the caller to count or re-join it.
    return null;
  }
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o['ts'] !== 'number' || typeof o['event'] !== 'string') return null;
  const data = o['data'];
  return { ts: o['ts'], event: o['event'], data: data && typeof data === 'object' ? (data as Record<string, unknown>) : null };
}

/** True when a fragment begins a record (as opposed to continuing one). */
export function isRecordHead(fragment: string): boolean {
  return fragment.trimStart().startsWith(EVENT_START);
}

/**
 * Splits a line at every `{"ts":` start. The pieces are raw slices, so
 * `splitFragments(l).join('') === l`. A line that does not begin with a
 * record start yields its leading piece first (the tail of an earlier record).
 */
export function splitFragments(line: string): string[] {
  const starts: number[] = [];
  for (let i = line.indexOf(EVENT_START); i >= 0; i = line.indexOf(EVENT_START, i + 1)) starts.push(i);
  if (starts[0] !== 0) starts.unshift(0);
  return starts.map((from, k) => line.slice(from, starts[k + 1] ?? line.length)).filter((f) => f !== '');
}

/** Result of reading a batch of lines. */
export interface SalvageResult {
  events: EventLine[];
  /** Pieces that could not be read and will not be retried. */
  unreadable: number;
  /**
   * An unreadable record head whose tail may still arrive as the first line
   * of the next batch (it was the last unresolved head of this batch). Not
   * counted yet — it becomes unreadable only if that next line does not
   * complete it.
   */
  pending: string | null;
}

/**
 * Tries to complete a dangling head with the next line: first the whole
 * line, then only its leading piece (when more records are glued after the
 * tail). Returns the event and how many leading fragments it consumed
 * (`Infinity` = the whole line), or null.
 */
export function rejoin(head: string, line: string): { event: EventLine; consumed: number } | null {
  const fragments = splitFragments(line);
  const lead = fragments[0];
  if (lead === undefined || isRecordHead(lead)) return null;
  const whole = parseEvent(head + line);
  if (whole) return { event: whole, consumed: Infinity };
  const joined = parseEvent(head + lead);
  return joined ? { event: joined, consumed: 1 } : null;
}

/**
 * Lines → events. A line is read whole when it parses; otherwise it is split
 * at every record start and each piece is read on its own. A piece that is
 * the head of a record and does not parse is held back and re-joined with
 * the leading piece of the next line — across calls via `pending`. Every
 * piece that cannot be read, and every held-back head that the next line
 * does not complete, is counted in `unreadable`; nothing is dropped silently.
 */
export function salvageLines(lines: string[], pending: string | null): SalvageResult {
  const events: EventLine[] = [];
  let unreadable = 0;
  let carry = pending;
  for (const line of lines) {
    let fragments = splitFragments(line);
    if (carry !== null) {
      const joined = rejoin(carry, line);
      carry = null;
      if (joined) {
        events.push(joined.event);
        fragments = fragments.slice(joined.consumed);
      } else {
        unreadable += 1;
      }
    }
    const rest = fragments.join('');
    if (rest.trim() === '') continue;
    const whole = parseEvent(rest);
    if (whole) {
      events.push(whole);
      continue;
    }
    for (const fragment of fragments) {
      if (fragment.trim() === '') continue;
      const e = parseEvent(fragment);
      if (e) {
        events.push(e);
      } else if (isRecordHead(fragment)) {
        // Only one head can wait for the next line; an earlier one is lost.
        if (carry !== null) unreadable += 1;
        carry = fragment;
      } else {
        unreadable += 1;
      }
    }
  }
  return { events, unreadable, pending: carry };
}
