import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef } from '../types.js';

/**
 * model/effort per agent name, from the frontmatter of the agent definition
 * files. This is the configured value; the subagent card prefers a per-call
 * model or the live panel's resolved model when it has one.
 */
export function readAgentDefs(dir: string): Map<string, AgentDef> {
  const defs = new Map<string, AgentDef>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return defs; // no agents directory: every subagent is a built-in
  }
  for (const file of names) {
    if (!file.endsWith('.md')) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
    if (front === undefined) continue;
    const field = (key: string): string | null => new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm').exec(front)?.[1] ?? null;
    defs.set(field('name') ?? file.slice(0, -3), { model: field('model'), effort: field('effort') });
  }
  return defs;
}
