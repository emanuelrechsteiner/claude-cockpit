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

  it('sends model AND effort, in that order', () => {
    // Order is load-bearing: a /model afterward could reset effort to the
    // new model's default.
    expect(switchCommands(opus, 'high')).toEqual(['/model claude-opus-5-5[1m]', '/effort high']);
  });

  it('sends only the model switch for models without effort', () => {
    expect(switchCommands(haiku, 'high')).toEqual([`/model ${haiku.id}`]);
  });

  it('omits /effort when no level was chosen', () => {
    expect(switchCommands(opus, null)).toEqual(['/model claude-opus-5-5[1m]']);
  });
});

describe('Model list', () => {
  it('contains only characters Claude Code understands as a model argument', () => {
    for (const m of MODEL_CHOICES) expect(m.id).toMatch(/^claude-[a-z0-9-]+(\[1m\])?$/);
  });
  it('starts the effort bar on medium', () => {
    expect(EFFORT_LEVELS[DEFAULT_EFFORT_INDEX]).toBe('medium');
  });
});

describe('hasReply', () => {
  const cmd = '/model claude-opus-5-5[1m]';
  // Screen excerpts as read off a real Claude Code 2.1.281.
  const answered = `❯ ${cmd}\n  ⎿  Set model to Opus 5.5 (1M context)\n────\n❯ \n`;

  it('recognizes the result line after the new echo', () => {
    expect(hasReply(answered, cmd, 0)).toBe(true);
  });
  it('waits while only the echo is there', () => {
    expect(hasReply(`❯ ${cmd}\n────\n❯ \n`, cmd, 0)).toBe(false);
  });
  it('is not fooled by an OLD reply to the same command', () => {
    // The same command already appeared earlier in the history; the new echo is still missing.
    expect(hasReply(answered, cmd, 1)).toBe(false);
    expect(countEchoes(answered, cmd)).toBe(1);
  });
  it('does not count a reply to a DIFFERENT command', () => {
    expect(hasReply(`❯ ${cmd}\n❯ /effort high\n  ⎿  Set effort\n`, '/effort medium', 0)).toBe(false);
  });
});

describe('clampIndex', () => {
  it('holds arrow-down at the last entry past the end of the list', () => {
    expect(clampIndex(99, MODEL_CHOICES.length)).toBe(MODEL_CHOICES.length - 1);
    expect(clampIndex(-1, 4)).toBe(0);
  });
});

describe('⌘7 since the seventh card', () => {
  it('recognizes ck7 as card focus, but not ck8', () => {
    expect(parseKey('\x1bck7')).toEqual({ type: 'focus', card: 7 });
    expect(parseKey('\x1bck8')).toBeNull();
  });
});
