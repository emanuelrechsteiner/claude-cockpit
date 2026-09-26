/**
 * Schnellwahl fuer Modell und Effort (Karte 1, seit 2026-09-24).
 *
 * Die Karte stellt nichts selbst um: sie tippt `/model <id>` und
 * `/effort <stufe>` in das linke Pane, als haette der Nutzer es getan. Damit
 * gilt genau das Verhalten von Claude Code — inklusive seiner Fehlermeldung,
 * falls ein Modell eine Stufe nicht kennt. Die Liste ist bewusst eine
 * Konstante: sie aendert sich mit jeder Modellgeneration, und dann gehoert
 * die Aenderung in die Bauakte (git), nicht in eine Laufzeitdatei.
 */

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface ModelChoice {
  label: string;
  /** Genau das Argument fuer `/model`. */
  id: string;
  /** false: Claude Code meldet fuer dieses Modell "Effort not supported". */
  effort: boolean;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { label: 'Fable 5.1 · 1M', id: 'claude-fable-5-1[1m]', effort: true },
  { label: 'Opus 5.5 · 1M', id: 'claude-opus-5-5[1m]', effort: true },
  { label: 'Sonnet 5', id: 'claude-sonnet-5', effort: true },
  { label: 'Haiku 4.5', id: 'claude-haiku-4-5', effort: false },
];

/** Startstufe der Effort-Leiste — die Vorgabe, die auch Claude Code setzt. */
export const DEFAULT_EFFORT_INDEX = EFFORT_LEVELS.indexOf('medium');

/** Pfeil-runter zaehlt unbegrenzt hoch; die Auswahl bleibt trotzdem in der Liste. */
export function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(i, length - 1));
}

/** Wie oft Claudes Eingabezeile genau diesen Befehl zeigt. */
export function countEchoes(screen: string, line: string): number {
  return screen.split('\n').filter((l) => l.trimEnd() === `❯ ${line}`).length;
}

/**
 * Hat Claude auf den zuletzt abgeschickten `line` geantwortet? Erkennbar an
 * einer Ergebniszeile (`⎿`) NACH dem neuesten Echo — und das Echo muss neu
 * sein (mehr als `echoesBefore`), sonst zaehlte eine alte Antwort auf
 * denselben Befehl weiter oben im Verlauf.
 *
 * Warum das noetig ist (gemessen 2026-09-24 an einem echten Claude Code
 * 2.1.281): beim ERSTEN Modellwechsel einer frischen Sitzung ging ein
 * `/effort`, das 700 ms nach `/model` getippt wurde, spurlos verloren — tmux
 * hatte beide Zeilen abgeliefert. Eine laengere feste Pause waere geraten;
 * auf die sichtbare Antwort zu warten ist es nicht.
 */
export function hasReply(screen: string, line: string, echoesBefore: number): boolean {
  const rows = screen.split('\n');
  const echoes = rows.flatMap((l, i) => (l.trimEnd() === `❯ ${line}` ? [i] : []));
  if (echoes.length <= echoesBefore) return false;
  return rows.slice(echoes[echoes.length - 1] + 1).some((l) => l.trimStart().startsWith('⎿'));
}

/**
 * Die Zeilen, die ins linke Pane getippt werden. Ohne Effort-Unterstuetzung
 * nur der Modellwechsel — ein `/effort` danach waere eine sichere Fehlermeldung.
 */
export function switchCommands(model: ModelChoice, effort: EffortLevel | null): string[] {
  const lines = [`/model ${model.id}`];
  if (model.effort && effort !== null) lines.push(`/effort ${effort}`);
  return lines;
}
