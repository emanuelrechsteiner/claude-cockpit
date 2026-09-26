import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginInfo } from '../types.js';

interface SettingsShape {
  enabledPlugins?: Record<string, boolean>;
}

export function listPlugins(settingsPath: string): PluginInfo[] {
  const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsShape;
  return Object.entries(raw.enabledPlugins ?? {}).map(([name, on]) => ({
    name,
    status: on ? 'enabled' : 'disabled',
  }));
}

export type PluginAction = 'enable' | 'disable' | 'update' | 'reauth';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9@._-]*$/;

export async function pluginAction(name: string, action: PluginAction, settingsPath: string): Promise<string> {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid plugin name: ${name}`);
  if (action === 'enable' || action === 'disable') {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsShape & Record<string, unknown>;
    raw.enabledPlugins = { ...raw.enabledPlugins, [name]: action === 'enable' };
    writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n');
    return `${action === 'enable' ? 'enabled' : 'disabled'} — takes effect next session`;
  }
  if (action === 'update') {
    await promisify(execFile)('claude', ['plugin', 'update', name], { timeout: 60000 });
    return 'updated — takes effect next session';
  }
  const server = name.split('@')[0];
  await promisify(execFile)('claude', ['mcp', 'login', server], { timeout: 15000 });
  return 'auth started — check your browser';
}
