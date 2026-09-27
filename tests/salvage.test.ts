import { describe, it, expect } from 'vitest';
import { parseEvent, isRecordHead, splitFragments, rejoin, salvageLines } from '../src/parse/salvage.js';

const rec = (ts: number, id: string) =>
  JSON.stringify({ ts, event: 'TaskUpdated', data: { tool_input: { taskId: id, status: 'completed' }, tool_response: { statusChange: { from: 'in_progress', to: 'completed' } } } });
const A = rec(1, '11');
const cut = A.indexOf('"to":"completed"') + '"to":"completed"'.length;
const head = A.slice(0, cut);
const tail = A.slice(cut);
const B = rec(2, '12');

describe('parseEvent', () => {
  it('reads an event object', () => {
    expect(parseEvent(B)).toMatchObject({ ts: 2, event: 'TaskUpdated' });
  });
  it('returns null for non-JSON and for JSON that is not an event', () => {
    for (const t of ['nope', head, 'null', '42', '{"event":"x"}', '{"ts":"1","event":"x"}']) expect(parseEvent(t)).toBeNull();
  });
  it('keeps data null when absent or not an object', () => {
    expect(parseEvent('{"ts":1,"event":"x"}')?.data).toBeNull();
    expect(parseEvent('{"ts":1,"event":"x","data":3}')?.data).toBeNull();
  });
});

describe('isRecordHead', () => {
  it('distinguishes a record start from a tail', () => {
    expect(isRecordHead(head)).toBe(true);
    expect(isRecordHead(`  ${head}`)).toBe(true);
    expect(isRecordHead(tail)).toBe(false);
  });
});

describe('splitFragments', () => {
  it('splits at every record start without losing a character', () => {
    const line = head + B;
    expect(splitFragments(line)).toEqual([head, B]);
    expect(splitFragments(tail + B).join('')).toBe(tail + B);
    expect(splitFragments(tail + B)).toEqual([tail, B]);
  });
  it('returns the line itself when it has no record start, and nothing for an empty line', () => {
    expect(splitFragments('garbage')).toEqual(['garbage']);
    expect(splitFragments('')).toEqual([]);
  });
});

describe('rejoin', () => {
  it('completes a head with the whole next line', () => {
    expect(rejoin(head, tail)).toMatchObject({ event: { ts: 1 }, consumed: Infinity });
  });
  it('completes a head with only the leading piece when a record is glued after the tail', () => {
    expect(rejoin(head, tail + B)).toMatchObject({ event: { ts: 1 }, consumed: 1 });
  });
  it('refuses when the next line starts a record of its own, or does not fit', () => {
    expect(rejoin(head, B)).toBeNull();
    expect(rejoin(head, '}garbage')).toBeNull();
    expect(rejoin(head, '')).toBeNull();
  });
});

describe('salvageLines', () => {
  it('reads plain lines whole', () => {
    expect(salvageLines([A, B], null)).toEqual({ events: [parseEvent(A), parseEvent(B)], unreadable: 0, pending: null });
  });
  it('holds back a trailing head instead of counting it', () => {
    const r = salvageLines([head + B], null);
    expect(r).toMatchObject({ unreadable: 0, pending: head });
    expect(r.events.map((e) => e.ts)).toEqual([2]);
  });
  it('re-joins a pending head with the next line and reads what is glued after it', () => {
    const r = salvageLines([tail + rec(3, '13')], head);
    expect(r).toMatchObject({ unreadable: 0, pending: null });
    expect(r.events.map((e) => e.ts)).toEqual([1, 3]);
  });
  it('counts a pending head the next line does not complete, then reads that line normally', () => {
    const r = salvageLines([B], head);
    expect(r).toMatchObject({ unreadable: 1, pending: null });
    expect(r.events.map((e) => e.ts)).toEqual([2]);
  });
  it('counts a stray tail with nothing pending', () => {
    expect(salvageLines([tail], null)).toMatchObject({ events: [], unreadable: 1, pending: null });
  });
  it('keeps only the last of two unreadable heads on one line pending', () => {
    const r = salvageLines(['{"ts":9,"event":' + head], null);
    expect(r).toMatchObject({ unreadable: 1, pending: head });
  });
  it('skips blank lines', () => {
    expect(salvageLines(['   '], null)).toEqual({ events: [], unreadable: 0, pending: null });
  });
});
