import type { Freshness } from '../types.js';

/**
 * Beyond this age, the newest sensor write counts as stale. While a Claude
 * session is open, the status line rewrites its mailbox on every refresh, so
 * five silent minutes means a sensor stopped — not a quiet session.
 */
export const DATA_STALE_AFTER_MS = 5 * 60_000;

/** Age of the on-screen data, as shown in the footer. */
export interface DataAge {
  /** "data 4s" / "data 3m" / "data 2h", or "no data yet". */
  text: string;
  /** true when the newest sensor write is older than DATA_STALE_AFTER_MS. */
  stale: boolean;
}

/** 4_000 → "4s", 180_000 → "3m", 7_200_000 → "2h" (floored; future clamps to 0s). */
export function formatAge(ageMs: number): string {
  const s = Math.floor(Math.max(0, ageMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * How old the data behind the dashboard is, from the NEWEST of the event log
 * and the status-line mailbox. The live subagent mailbox is deliberately
 * ignored: it is only written while the agent panel shows rows, so an old
 * one is normal whenever no subagent runs.
 *
 * @param freshness sensor file mtimes in ms (null = file missing)
 * @param now current time in ms
 * @returns footer text and whether it should be flagged as stale
 * @example dataAge({ eventsMs: 0, statusMs: 4_000, liveMs: null }, 8_000) // { text: 'data 4s', stale: false }
 */
export function dataAge(freshness: Freshness, now: number): DataAge {
  const candidates = [freshness.eventsMs, freshness.statusMs].filter((v): v is number => v !== null);
  if (candidates.length === 0) return { text: 'no data yet', stale: false };
  const age = now - Math.max(...candidates);
  return { text: `data ${formatAge(age)}`, stale: age > DATA_STALE_AFTER_MS };
}
