import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import type { LinkItem, FileItem } from '../types.js';
import { classifyUrl, isImportantFile, type Rules } from '../rules.js';
import { extractDispatches, type Dispatch } from './dispatch-map.js';

const URL_RE = /https?:\/\/[^\s"'<>\])]+/g;

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: { file_path?: string };
}

interface TranscriptLine {
  type?: string;
  message?: { content?: ContentBlock[] | string };
}

/**
 * Links, written files and Agent dispatch outcomes from new transcript lines.
 * `agentCalls` carries the Agent/Task tool_use ids across polls (the result
 * can arrive polls after its call); pass the same set every time.
 */
export function parseTranscriptLines(
  lines: string[],
  rules: Rules,
  agentCalls: Set<string> = new Set(),
): { links: LinkItem[]; files: FileItem[]; dispatches: Dispatch[] } {
  const links = new Map<string, LinkItem>();
  const files = new Map<string, FileItem>();
  const dispatches: Dispatch[] = [];
  for (const line of lines) {
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    dispatches.push(...extractDispatches(obj, agentCalls));
    if (obj.type !== 'assistant' || !Array.isArray(obj.message?.content)) continue;
    for (const block of obj.message.content) {
      if (block.type === 'text' && block.text) {
        for (const url of block.text.match(URL_RE) ?? []) {
          const item = classifyUrl(url, rules);
          if (item) links.set(item.url, item);
        }
      }
      if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit') && block.input?.file_path) {
        const p = block.input.file_path;
        const origin = isImportantFile(p.split('/').slice(-2).join('/'), rules) ? 'candidate' : 'written';
        files.set(p, { path: p, origin, ts: Date.now() });
      }
    }
  }
  return { links: [...links.values()], files: [...files.values()], dispatches };
}

/**
 * Complete new lines since `offset`. `offset`, `newOffset` and `size` are all
 * BYTE positions: the newline is searched in the raw buffer, never in decoded
 * text, because a character index drifts from the byte position as soon as a
 * multibyte UTF-8 character appears (and the next poll re-reads mid-line).
 * An incomplete last line — even one cut inside a multibyte sequence — is not
 * decoded; `newOffset` stays at its start so the next poll reads it whole.
 */
export function readNewLines(path: string, offset: number): { lines: string[]; newOffset: number; size: number } {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { lines: [], newOffset: size, size };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return { lines: [], newOffset: offset, size };
    const text = buf.subarray(0, lastNl).toString('utf8');
    return { lines: text.split('\n').filter(Boolean), newOffset: offset + lastNl + 1, size };
  } finally {
    closeSync(fd);
  }
}
