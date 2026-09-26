import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPlugins, pluginAction } from '../src/plugins/actions.js';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
  const p = join(dir, 'settings.json');
  writeFileSync(
    p,
    JSON.stringify({
      enabledPlugins: {
        'superpowers@claude-plugins-official': true,
        'pixel-plugin@pixel-plugin': false,
      },
    }),
  );
  return p;
}

describe('listPlugins', () => {
  it('reads enabled plugins from settings fixture', () => {
    const plugins = listPlugins(fixture());
    expect(plugins.find((x) => x.name.startsWith('superpowers'))?.status).toBe('enabled');
    expect(plugins.find((x) => x.name.startsWith('pixel-plugin'))?.status).toBe('disabled');
  });
});

describe('pluginAction enable/disable', () => {
  it('toggles the flag in settings.json and reports pending change', async () => {
    const p = fixture();
    const msg = await pluginAction('pixel-plugin@pixel-plugin', 'enable', p);
    expect(msg).toContain('next session');
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { enabledPlugins: Record<string, boolean> };
    expect(raw.enabledPlugins['pixel-plugin@pixel-plugin']).toBe(true);
    await pluginAction('pixel-plugin@pixel-plugin', 'disable', p);
    const raw2 = JSON.parse(readFileSync(p, 'utf8')) as { enabledPlugins: Record<string, boolean> };
    expect(raw2.enabledPlugins['pixel-plugin@pixel-plugin']).toBe(false);
  });
});
