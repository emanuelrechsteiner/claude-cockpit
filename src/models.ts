/**
 * Quick-switch for model and effort (card 1, since 2026-09-24).
 *
 * The card never switches anything itself: it types `/model <id>` and
 * `/effort <level>` into the left pane, as if the user had done it. That way
 * exactly Claude Code's own behavior applies — including its error message
 * if a model doesn't know a given level. The list is deliberately a
 * constant: it changes with every model generation, and that change then
 * belongs in the build record (git), not a runtime file.
 */

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface ModelChoice {
  label: string;
  /** The exact argument for `/model`. */
  id: string;
  /** false: Claude Code reports "Effort not supported" for this model. */
  effort: boolean;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { label: 'Fable 5.1 · 1M', id: 'claude-fable-5-1[1m]', effort: true },
  { label: 'Opus 5.5 · 1M', id: 'claude-opus-5-5[1m]', effort: true },
  { label: 'Sonnet 5', id: 'claude-sonnet-5', effort: true },
  { label: 'Haiku 4.5', id: 'claude-haiku-4-5', effort: false },
];

/** Starting level of the effort bar — the same default Claude Code itself uses. */
export const DEFAULT_EFFORT_INDEX = EFFORT_LEVELS.indexOf('medium');

/** Arrow-down counts up without limit; the selection still stays within the list. */
export function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(i, length - 1));
}

/** How many times Claude's input line shows exactly this command. */
export function countEchoes(screen: string, line: string): number {
  return screen.split('\n').filter((l) => l.trimEnd() === `❯ ${line}`).length;
}

/**
 * Did Claude answer the most recently submitted `line`? Recognized by a
 * result line (`⎿`) AFTER the newest echo — and the echo must be new (more
 * than `echoesBefore`), otherwise an old reply to the same command further
 * up in the history would count.
 *
 * Why this is needed (measured 2026-09-24 against a real Claude Code
 * 2.1.281): on the FIRST model switch of a fresh session, an `/effort` typed
 * 700 ms after `/model` vanished without a trace — tmux had delivered both
 * lines. A longer fixed pause would be a guess; waiting for the visible
 * reply is not.
 */
export function hasReply(screen: string, line: string, echoesBefore: number): boolean {
  const rows = screen.split('\n');
  const echoes = rows.flatMap((l, i) => (l.trimEnd() === `❯ ${line}` ? [i] : []));
  if (echoes.length <= echoesBefore) return false;
  return rows.slice(echoes[echoes.length - 1] + 1).some((l) => l.trimStart().startsWith('⎿'));
}

/**
 * The lines typed into the left pane. Without effort support, only the model
 * switch — an `/effort` afterward would be a guaranteed error message.
 */
export function switchCommands(model: ModelChoice, effort: EffortLevel | null): string[] {
  const lines = [`/model ${model.id}`];
  if (model.effort && effort !== null) lines.push(`/effort ${effort}`);
  return lines;
}
