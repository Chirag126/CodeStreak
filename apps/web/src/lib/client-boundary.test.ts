// Guards against the Video 1 crash: a server component called explorerTxUrl() imported from a
// 'use client' module, which throws at runtime ("Attempted to call … from the server"). Components
// (PascalCase) may cross the boundary; plain functions and constants may not.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

const isClient = (src: string) => /^\s*['"]use client['"]/.test(src);

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext)) return normalize(base + ext);
  return null;
}

describe('server/client boundary', () => {
  it('no server file imports a non-component value from a "use client" module', () => {
    const files = walk(SRC);
    const client = new Set(files.filter((f) => isClient(readFileSync(f, 'utf8'))).map((f) => normalize(f)));
    const problems: string[] = [];
    for (const f of files) {
      if (client.has(normalize(f))) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
        const target = resolve(m[2]!, f);
        if (!target || !client.has(target)) continue;
        const names = m[1]!
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith('type '))
          .map((n) => n.split(/\s+as\s+/).pop()!);
        for (const n of names) if (!/^[A-Z][a-z]/.test(n)) problems.push(`${f.slice(SRC.length + 1)} imports ${n} from client module ${m[2]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
