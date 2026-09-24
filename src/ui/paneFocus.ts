import { execFile } from 'node:child_process';

/**
 * Gibt den tmux-Fokus ans linke Pane (Claude) zurueck — und reicht dabei auf
 * Wunsch ein versehentlich hier gelandetes Zeichen mit hinueber.
 *
 * Hintergrund: Seit 2026-08-04 setzt ⌘1-6 den tmux-Fokus mit auf das
 * Dashboard, damit Pfeile und Enter ohne weitere Tastenkombinationen wirken
 * (GUI-Verhalten: Panel anwaehlen, darin arbeiten, wieder raus). Der Preis
 * waere sonst, dass ein Nutzer nach dem Blick auf die Karte weitertippt und
 * sein Text im Dashboard verschwindet. Deshalb: das erste normale Zeichen
 * schickt den Fokus zurueck UND wird nach links durchgereicht — es geht
 * nichts verloren, und ab dem zweiten Zeichen tippt man wieder normal.
 *
 * Fail-open in jeder Hinsicht: ausserhalb von tmux passiert nichts, und ein
 * Fehler im tmux-Aufruf darf das Dashboard nie stoeren.
 */

/** Nur innerhalb einer tmux-Sitzung gibt es ueberhaupt Panes. */
function inTmux(): boolean {
  return typeof process.env['TMUX'] === 'string' && process.env['TMUX'] !== '';
}

/**
 * `-L` waehlt richtungsbezogen das Pane LINKS vom aktiven. Der Launcher legt
 * das Dashboard immer rechts an (`split-window -h`), damit trifft das.
 */
export function returnFocusLeft(): void {
  if (!inTmux()) return;
  execFile('tmux', ['select-pane', '-L'], () => {
    /* fail-open: ein fehlgeschlagener Fokuswechsel darf nichts blockieren */
  });
}

/**
 * Schickt ein Zeichen ans linke Pane. `-l` = literal, damit tmux es nicht als
 * Tastennamen deutet ("q" bliebe sonst q, aber "Enter" waere ein Sonderfall);
 * `--` beendet die Optionsliste, damit ein Zeichen wie "-" nicht als Flag
 * gelesen wird. execFile mit Argumentliste, also KEINE Shell — der Text kommt
 * aus der Tastatur und wird nirgends interpretiert.
 */
export function forwardToLeft(text: string): void {
  if (!inTmux() || text === '') return;
  execFile('tmux', ['send-keys', '-l', '-t', '{left}', '--', text], () => {
    /* fail-open */
  });
}
