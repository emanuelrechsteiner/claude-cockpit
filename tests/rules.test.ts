import { describe, it, expect } from 'vitest';
import { loadRules, classifyUrl, isImportantFile } from '../src/rules.js';

describe('rules', () => {
  const rules = loadRules(new URL('../config/rules.json', import.meta.url).pathname);
  it('classifies vercel previews', () => {
    expect(classifyUrl('https://myapp-abc123.vercel.app/', rules)?.kind).toBe('preview');
  });
  it('classifies claude artifacts', () => {
    expect(classifyUrl('https://claude.ai/public/artifacts/xyz', rules)?.kind).toBe('artifact');
  });
  it('rejects noise urls', () => {
    expect(classifyUrl('https://registry.npmjs.org/ink', rules)).toBeNull();
  });
  it('marks candidate files important', () => {
    expect(isImportantFile('CLAUDE.md', rules)).toBe(true);
    expect(isImportantFile('docs/ARCHITECTURE.md', rules)).toBe(true);
    expect(isImportantFile('src/foo.ts', rules)).toBe(false);
  });
});
