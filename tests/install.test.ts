import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// install.sh drives Ghostty/tmux/Node/jq installs via Homebrew and clones a
// fresh copy of the repo when run for real — none of that is safe or
// hermetic inside a test run. Every test below redirects every touchable
// path (COCKPIT_DIR/COCKPIT_SETTINGS/COCKPIT_GHOSTTY_CONFIG/
// COCKPIT_GHOSTTY_THEMES/COCKPIT_BIN_DIR) into a throwaway temp tree and
// sets COCKPIT_SKIP_BREW=1 + COCKPIT_SKIP_NPM=1 so nothing here ever
// touches the real machine or the network.

const REPO_ROOT = resolve(__dirname, '..');
const INSTALL_SH = join(REPO_ROOT, 'install.sh');

interface Sandbox {
  dir: string;
  cockpitDir: string; // a copy of the repo (minus .git/node_modules) install.sh runs from
  settings: string;
  ghosttyConfig: string;
  ghosttyThemes: string;
  binDir: string;
}

function makeSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-install-'));
  const cockpitDir = join(dir, 'cockpit-src');
  mkdirSync(cockpitDir, { recursive: true });
  // Only what install.sh actually reads: the script itself + config/*.
  // Copying just these (not the whole repo) keeps the sandbox small and
  // guarantees no stray .git/node_modules leaks in.
  mkdirSync(join(cockpitDir, 'config'), { recursive: true });
  cpSync(INSTALL_SH, join(cockpitDir, 'install.sh'));
  cpSync(join(REPO_ROOT, 'config'), join(cockpitDir, 'config'), { recursive: true });
  // Simulate "npm install already ran" so the npm step is a no-op and never
  // touches the network.
  mkdirSync(join(cockpitDir, 'node_modules'), { recursive: true });
  return {
    dir,
    cockpitDir,
    settings: join(dir, 'settings.json'),
    ghosttyConfig: join(dir, 'ghostty-config'),
    ghosttyThemes: join(dir, 'ghostty-themes'),
    binDir: join(dir, 'bin'),
  };
}

function envFor(sb: Sandbox): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COCKPIT_DIR: sb.cockpitDir,
    COCKPIT_SETTINGS: sb.settings,
    COCKPIT_GHOSTTY_CONFIG: sb.ghosttyConfig,
    COCKPIT_GHOSTTY_THEMES: sb.ghosttyThemes,
    COCKPIT_BIN_DIR: sb.binDir,
    COCKPIT_SKIP_BREW: '1',
    COCKPIT_SKIP_NPM: '1',
  };
}

function run(sb: Sandbox, args: string[]): string {
  return execFileSync('bash', [join(sb.cockpitDir, 'install.sh'), ...args], {
    env: envFor(sb),
    encoding: 'utf8',
  });
}

let sandboxes: Sandbox[] = [];

beforeEach(() => {
  sandboxes = [];
});

afterEach(() => {
  for (const sb of sandboxes) {
    rmSync(sb.dir, { recursive: true, force: true });
  }
});

function sandbox(): Sandbox {
  const sb = makeSandbox();
  sandboxes.push(sb);
  return sb;
}

describe('install.sh', () => {
  it('merges into an existing foreign hook block without losing it', () => {
    const sb = sandbox();
    writeFileSync(
      sb.settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Task|Agent',
              hooks: [{ type: 'command', command: 'bash /some/other/hook.sh' }],
            },
          ],
        },
      }),
    );

    run(sb, ['--yes']);

    const settings = JSON.parse(readFileSync(sb.settings, 'utf8'));
    const preToolUseBlock = settings.hooks.PreToolUse.find((b: { matcher: string }) => b.matcher === 'Task|Agent');
    const commands = preToolUseBlock.hooks.map((h: { command: string }) => h.command);
    expect(commands).toContain('bash /some/other/hook.sh');
    expect(commands.some((c: string) => c.includes('SubagentStart'))).toBe(true);
    expect(commands).toHaveLength(2);
  });

  it('is idempotent: a second run leaves settings.json byte-identical and reports nothing to do', () => {
    const sb = sandbox();
    run(sb, ['--yes']);
    const after1 = readFileSync(sb.settings, 'utf8');

    const secondOutput = run(sb, ['--yes']);

    const after2 = readFileSync(sb.settings, 'utf8');
    expect(after2).toBe(after1);
    expect(secondOutput).toMatch(/settings\.json.*already up to date/);
    expect(secondOutput).not.toMatch(/backed up to/);
  });

  it('adds the Ghostty keybindings and theme line exactly once, even after a second run', () => {
    const sb = sandbox();
    run(sb, ['--yes']);
    run(sb, ['--yes']); // second run must not duplicate anything

    const config = readFileSync(sb.ghosttyConfig, 'utf8');
    const keybindLines = config.split('\n').filter((l) => l.startsWith('keybind = '));
    const themeLines = config.split('\n').filter((l) => l === 'theme = rcode');
    expect(keybindLines).toHaveLength(14);
    expect(themeLines).toHaveLength(1);

    const themeFile = join(sb.ghosttyThemes, 'rcode');
    const installed = readFileSync(themeFile, 'utf8');
    const source = readFileSync(join(sb.cockpitDir, 'config', 'ghostty-theme-rcode'), 'utf8');
    expect(installed).toBe(source);
  });

  it('--dry-run changes nothing at all', () => {
    const sb = sandbox();
    // Seed a pre-existing settings.json + ghostty config so we have real
    // files whose mtime/content we can assert are untouched.
    writeFileSync(sb.settings, JSON.stringify({ existing: true }));
    mkdirSync(join(sb.dir), { recursive: true });
    writeFileSync(sb.ghosttyConfig, '# pre-existing config\n');

    const settingsBefore = readFileSync(sb.settings, 'utf8');
    const ghosttyBefore = readFileSync(sb.ghosttyConfig, 'utf8');
    const settingsMtimeBefore = statSync(sb.settings).mtimeMs;
    const ghosttyMtimeBefore = statSync(sb.ghosttyConfig).mtimeMs;

    const output = run(sb, ['--dry-run']);

    expect(readFileSync(sb.settings, 'utf8')).toBe(settingsBefore);
    expect(readFileSync(sb.ghosttyConfig, 'utf8')).toBe(ghosttyBefore);
    expect(statSync(sb.settings).mtimeMs).toBe(settingsMtimeBefore);
    expect(statSync(sb.ghosttyConfig).mtimeMs).toBe(ghosttyMtimeBefore);
    expect(output).toMatch(/Dry run — no changes were made\./);
  });

  it('registers all 10 snippet entries (8 hook commands + 2 status lines) on a fresh machine', () => {
    const sb = sandbox();

    run(sb, ['--yes']);

    const settings = JSON.parse(readFileSync(sb.settings, 'utf8'));
    const hookCommandCount = Object.values(settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flat()
      .flatMap((block) => block.hooks ?? [])
      .length;
    expect(hookCommandCount).toBe(8);
    expect(settings).toHaveProperty('statusLine.command');
    expect(settings).toHaveProperty('subagentStatusLine.command');
    expect(hookCommandCount + 2).toBe(10);
  });
});
