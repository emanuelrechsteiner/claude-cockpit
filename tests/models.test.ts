import { describe, it, expect } from 'vitest';
import {
  EFFORT_LEVELS,
  MODEL_CHOICES,
  DEFAULT_EFFORT_INDEX,
  clampIndex,
  countEchoes,
  hasReply,
  switchCommands,
} from '../src/models.js';
import { parseKey } from '../src/keyboard.js';

describe('switchCommands', () => {
  const opus = MODEL_CHOICES.find((m) => m.id === 'claude-opus-5-5[1m]')!;
  const haiku = MODEL_CHOICES.find((m) => !m.effort)!;

  it('schickt Modell UND Effort, in dieser Reihenfolge', () => {
    // Reihenfolge ist tragend: ein /model danach koennte den Effort auf die
    // Vorgabe des neuen Modells zuruecksetzen.
    expect(switchCommands(opus, 'high')).toEqual(['/model claude-opus-5-5[1m]', '/effort high']);
  });

  it('schickt bei Modellen ohne Effort nur den Modellwechsel', () => {
    expect(switchCommands(haiku, 'high')).toEqual([`/model ${haiku.id}`]);
  });

  it('laesst /effort weg, wenn keine Stufe gewaehlt wurde', () => {
    expect(switchCommands(opus, null)).toEqual(['/model claude-opus-5-5[1m]']);
  });
});

describe('Modellliste', () => {
  it('enthaelt nur Zeichen, die Claude Code als Modell-Argument versteht', () => {
    for (const m of MODEL_CHOICES) expect(m.id).toMatch(/^claude-[a-z0-9-]+(\[1m\])?$/);
  });
  it('startet die Effort-Leiste auf medium', () => {
    expect(EFFORT_LEVELS[DEFAULT_EFFORT_INDEX]).toBe('medium');
  });
});

describe('hasReply', () => {
  const cmd = '/model claude-opus-5-5[1m]';
  // Bildschirmausschnitte wie am echten Claude Code 2.1.281 abgelesen.
  const answered = `❯ ${cmd}\n  ⎿  Set model to Opus 5.5 (1M context)\n────\n❯ \n`;

  it('erkennt die Ergebniszeile nach dem neuen Echo', () => {
    expect(hasReply(answered, cmd, 0)).toBe(true);
  });
  it('wartet, solange nur das Echo steht', () => {
    expect(hasReply(`❯ ${cmd}\n────\n❯ \n`, cmd, 0)).toBe(false);
  });
  it('laesst sich nicht von einer ALTEN Antwort auf denselben Befehl taeuschen', () => {
    // Derselbe Befehl stand schon einmal im Verlauf, das neue Echo fehlt noch.
    expect(hasReply(answered, cmd, 1)).toBe(false);
    expect(countEchoes(answered, cmd)).toBe(1);
  });
  it('zaehlt eine Antwort auf einen ANDEREN Befehl nicht', () => {
    expect(hasReply(`❯ ${cmd}\n❯ /effort high\n  ⎿  Set effort\n`, '/effort medium', 0)).toBe(false);
  });
});

describe('clampIndex', () => {
  it('haelt Pfeil-runter ueber das Listenende auf dem letzten Eintrag', () => {
    expect(clampIndex(99, MODEL_CHOICES.length)).toBe(MODEL_CHOICES.length - 1);
    expect(clampIndex(-1, 4)).toBe(0);
  });
});

describe('⌘7 seit der siebten Karte', () => {
  it('erkennt ck7 als Kartenfokus, ck8 aber nicht', () => {
    expect(parseKey('\x1bck7')).toEqual({ type: 'focus', card: 7 });
    expect(parseKey('\x1bck8')).toBeNull();
  });
});
