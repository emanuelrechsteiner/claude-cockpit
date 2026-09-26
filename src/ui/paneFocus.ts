import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { countEchoes, hasReply } from '../models.js';

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

const tmuxRun = promisify(execFile);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sichtbarer Inhalt links samt 200 Zeilen Verlauf; -J fuegt umgebrochene Zeilen zusammen. */
async function captureLeft(): Promise<string> {
  const { stdout } = await tmuxRun('tmux', ['capture-pane', '-p', '-J', '-t', '{left}', '-S', '-200']);
  return stdout;
}

/**
 * Tippt ganze Befehlszeilen links ein und schickt jede mit Enter ab (Karte
 * Modell & Effort). Anders als die Zeichen-Durchreiche oben NICHT fail-open:
 * wer "Opus · high" gewaehlt hat, muss erfahren, wenn es nicht ankam — der
 * Aufrufer zeigt den Fehler auf der Karte an.
 *
 * Vor jeder weiteren Zeile wird gewartet, bis Claude die vorige sichtbar
 * beantwortet hat (siehe hasReply in models.ts — dort steht, warum eine feste
 * Pause nicht reichte). Bleibt die Antwort aus, etwa weil Claude gerade
 * mitten in einer Antwort steckt, wird der Rest NICHT blind hinterhergeschickt.
 */
export async function submitToLeft(lines: string[], replyTimeoutMs = 6000): Promise<void> {
  if (!inTmux()) throw new Error('kein tmux — linkes Pane nicht erreichbar');
  for (const [i, line] of lines.entries()) {
    const echoesBefore = countEchoes(await captureLeft(), line);
    await tmuxRun('tmux', ['send-keys', '-l', '-t', '{left}', '--', line]);
    await tmuxRun('tmux', ['send-keys', '-t', '{left}', 'Enter']);
    if (i === lines.length - 1) break;
    const deadline = Date.now() + replyTimeoutMs;
    while (!hasReply(await captureLeft(), line, echoesBefore)) {
      if (Date.now() > deadline) throw new Error(`${line} unbestätigt — Rest nicht gesendet`);
      await pause(150);
    }
    await pause(250);
  }
}
