import { describe, it, expect } from 'vitest';
import { dataAge, DATA_STALE_AFTER_MS } from '../src/ui/freshness-view.js';

const NOW = 10_000_000_000;
const f = (eventsMs: number | null, statusMs: number | null, liveMs: number | null = null) => ({
  eventsMs,
  statusMs,
  liveMs,
});

describe('dataAge', () => {
  it('reports "no data yet" and not stale when every sensor file is missing', () => {
    expect(dataAge(f(null, null, null), NOW)).toEqual({ text: 'no data yet', stale: false });
  });

  it('formats seconds up to 59s, then switches to minutes at 60s', () => {
    expect(dataAge(f(NOW, null), NOW).text).toBe('data 0s');
    expect(dataAge(f(NOW - 4_000, null), NOW).text).toBe('data 4s');
    expect(dataAge(f(NOW - 59_999, null), NOW).text).toBe('data 59s');
    expect(dataAge(f(NOW - 60_000, null), NOW).text).toBe('data 1m');
  });

  it('formats minutes up to 59m, then switches to hours at 60m', () => {
    expect(dataAge(f(null, NOW - 3 * 60_000), NOW).text).toBe('data 3m');
    expect(dataAge(f(null, NOW - (60 * 60_000 - 1)), NOW).text).toBe('data 59m');
    expect(dataAge(f(null, NOW - 60 * 60_000), NOW).text).toBe('data 1h');
    expect(dataAge(f(null, NOW - 2 * 3_600_000), NOW).text).toBe('data 2h');
  });

  it('uses the NEWEST of events and status', () => {
    expect(dataAge(f(NOW - 2 * 3_600_000, NOW - 4_000), NOW)).toEqual({ text: 'data 4s', stale: false });
    expect(dataAge(f(NOW - 4_000, NOW - 2 * 3_600_000), NOW)).toEqual({ text: 'data 4s', stale: false });
  });

  it('ignores the live subagent mailbox even when it is the newest file', () => {
    expect(dataAge(f(NOW - 2 * 3_600_000, null, NOW - 1_000), NOW)).toEqual({ text: 'data 2h', stale: true });
    expect(dataAge(f(null, null, NOW - 1_000), NOW)).toEqual({ text: 'no data yet', stale: false });
  });

  it('is not stale exactly at the threshold and stale just above it', () => {
    expect(DATA_STALE_AFTER_MS).toBe(5 * 60_000);
    expect(dataAge(f(NOW - DATA_STALE_AFTER_MS, null), NOW)).toEqual({ text: 'data 5m', stale: false });
    expect(dataAge(f(NOW - DATA_STALE_AFTER_MS - 1, null), NOW)).toEqual({ text: 'data 5m', stale: true });
  });

  it('clamps a future mtime (clock skew) to 0s instead of a negative age', () => {
    expect(dataAge(f(NOW + 5_000, null), NOW)).toEqual({ text: 'data 0s', stale: false });
  });
});
