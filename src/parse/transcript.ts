import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import type { LinkItem, FileItem } from '../types.js';
import { classifyUrl, isImportantFile, type Rules } from '../rules.js';

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

export function parseTranscriptLines(lines: string[], rules: Rules): { links: LinkItem[]; files: FileItem[] } {
  const links = new Map<string, LinkItem>();
  const files = new Map<string, FileItem>();
  for (const line of lines) {
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
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
  return { links: [...links.values()], files: [...files.values()] };
}

export function readNewLines(path: string, offset: number): { lines: string[]; newOffset: number } {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { lines: [], newOffset: size };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return { lines: [], newOffset: offset };
    return { lines: text.slice(0, lastNl).split('\n').filter(Boolean), newOffset: offset + lastNl + 1 };
  } finally {
    closeSync(fd);
  }
}
