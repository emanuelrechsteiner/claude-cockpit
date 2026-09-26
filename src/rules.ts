import { readFileSync } from 'node:fs';
import type { LinkItem } from './types.js';

export interface LinkRule {
  kind: LinkItem['kind'];
  pattern: string;
}

export interface Rules {
  links: LinkRule[];
  linkDenylist: string[];
  fileCandidates: string[];
}

export function loadRules(path: string): Rules {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Rules;
  if (!Array.isArray(raw.links)) throw new Error(`rules.json invalid: links missing (${path})`);
  return raw;
}

export function classifyUrl(url: string, rules: Rules): LinkItem | null {
  if (rules.linkDenylist.some((p) => new RegExp(p).test(url))) return null;
  for (const r of rules.links) {
    if (new RegExp(r.pattern).test(url)) {
      return { url, kind: r.kind, label: url.replace(/^https?:\/\//, '').slice(0, 44), ts: Date.now() };
    }
  }
  return null;
}

function globToRegExp(glob: string): RegExp {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

export function isImportantFile(relPath: string, rules: Rules): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  return rules.fileCandidates.some((g) => globToRegExp(g).test(relPath) || globToRegExp(g).test(base));
}
