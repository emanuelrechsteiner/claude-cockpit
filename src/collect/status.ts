import { readFileSync } from 'node:fs';
import type { StatusInfo, StatusWindow } from '../types.js';

/**
 * Liest den Briefkasten, den statusline/statusline.sh pro Sitzung ablegt.
 *
 * Warum ueberhaupt ein Briefkasten: Claude Code uebergibt Kontext- und
 * Verbrauchszahlen AUSSCHLIESSLICH der Statuszeile, auf stdin. Das Dashboard
 * ist ein eigener Prozess und bekommt sie nie zu sehen. Die Statuszeile legt
 * sie deshalb als status-<session>.json ab.
 *
 * Veraltete Staende werden NICHT verschwiegen, sondern als `stale` markiert:
 * Die Statuszeile laeuft nur, wenn Claude arbeitet. Steht die Sitzung still,
 * altert die Zahl — sie dann unmarkiert weiterzuzeigen wuerde einen Stand
 * vortaeuschen, den niemand geprueft hat.
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
    // Speist sich aus context_window.total_input_tokens — den Token IM
    // FENSTER, Cache eingerechnet. Siehe statusline.sh: current_usage zaehlt
    // nur den letzten API-Aufruf und ergaebe hier eine irrefuehrende Zahl.
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
