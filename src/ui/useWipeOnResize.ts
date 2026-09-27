import { useEffect } from 'react';
import { useStdout } from 'ink';

/**
 * Ghost frames (2026-08-04): Ink erases its previous frame by moving the
 * cursor up by the LAST rendered line count (log-update). When the terminal
 * width changes, the lines wrap differently, so the remembered count no
 * longer matches — the old frame stays put and the new one is drawn below
 * it. Measured on the running dashboard: SEVEN stacked frames, each at a
 * different width. Two visible symptoms: the cards appear multiple times,
 * and the topmost (dead) frame no longer reacts to any key — which looks
 * like broken keyboard control even though focus correctly moves in the
 * live frame.
 *
 * Fix: on every resize, clear the screen AND the scrollback buffer
 * (\x1b[3J).
 *
 * prependListener is LOAD-BEARING here, not a style choice: Ink attaches
 * its own resize listener in its constructor, i.e. BEFORE us. A plain
 * .on() would run afterward and would wipe the frame Ink just drew — and
 * Ink would NOT redraw it, because it discards an unchanged frame via
 * dedupe (ink.js: `output !== this.lastOutput`). That is exactly why the
 * first version of this fix did nothing; tests/e2e/resize-regression.sh
 * caught it.
 *
 * STILL NEEDED after the upgrade to Ink 7.1.1 + Alternate Screen
 * (2026-08-04, MEASURED, not assumed): Ink 7.1.1 includes the official
 * resize fix (PR #828, since 6.5.1) and Alternate Screen isolates from
 * tmux scrollback — together these keep single, slowly-successive resizes
 * clean. A FAST BURST of resizes without a pause (a real window-edge drag)
 * still breaks the native fix: measured 8 -> 13 card frames and a
 * duplicated "Team Lead" WITHOUT this wipe handler, clean (8, single)
 * WITH it — same Ink/React version in both cases. This fix therefore
 * stays in place. Test: tests/e2e/resize-regression.sh (burst stimulus).
 */
export function useWipeOnResize(): void {
  const { stdout } = useStdout();
  useEffect(() => {
    if (!stdout) return;
    const wipe = () => stdout.write('\x1b[2J\x1b[3J\x1b[H');
    wipe(); // leftovers from a previous instance in the pane
    stdout.prependListener('resize', wipe);
    return () => {
      stdout.off('resize', wipe);
    };
  }, [stdout]);
}
