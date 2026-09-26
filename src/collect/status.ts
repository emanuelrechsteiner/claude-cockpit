import { readFileSync } from 'node:fs';
import type { StatusInfo, StatusWindow } from '../types.js';

/**
 * Reads the mailbox that statusline/statusline.sh drops per session.
 *
 * Why a mailbox at all: Claude Code hands context and usage numbers
 * EXCLUSIVELY to the status line, on stdin. The dashboard is a separate
 * process and never sees them. The status line therefore drops them as
 * status-<session>.json.
 *
 * Stale readings are NOT hidden, but marked `stale`: the status line only
 * runs while Claude is working. If the session sits idle, the number ages —
 * continuing to show it unmarked would fake a reading nobody has checked.
 */
export const STALE_AFTER_SECONDS = 120;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function windowOf(v: unknown): StatusWindow | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const used = num(o['used_percentage']);
  const resets = num(o['resets_at']);
  if (used === null && resets === null) return null;
  return { usedPercentage: used, resetsAt: resets };
}

export function readStatus(path: string, nowSeconds = Math.floor(Date.now() / 1000)): StatusInfo {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const ctx = (raw['context'] ?? {}) as Record<string, unknown>;
  const cost = (raw['cost'] ?? {}) as Record<string, unknown>;
  const limits = (raw['rate_limits'] ?? {}) as Record<string, unknown>;
  const ts = num(raw['ts']) ?? 0;

  return {
    ts,
    stale: nowSeconds - ts > STALE_AFTER_SECONDS,
    model: str(raw['model']),
    contextPct: num(ctx['used_percentage']),
    windowSize: num(ctx['window_size']),
    // Fed from context_window.total_input_tokens — the tokens IN THE
    // WINDOW, cache included. See statusline.sh: current_usage only counts
    // the last API call and would give a misleading number here.
    inputTokens: num(ctx['input_tokens']),
    outputTokens: num(ctx['output_tokens']),
    costUsd: num(cost['total_usd']),
    durationMs: num(cost['duration_ms']),
    linesAdded: num(cost['lines_added']),
    linesRemoved: num(cost['lines_removed']),
    fiveHour: windowOf(limits['five_hour']),
    sevenDay: windowOf(limits['seven_day']),
  };
}
