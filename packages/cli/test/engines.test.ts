import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;

/** Minimum Node version from a range like ">=22.12.0" or "^20.19.0 || >=22.12.0" (lowest allowed). */
function minNode(range: string | undefined): [number, number] | null {
  if (!range) return null;
  const mins = range
    .split('||')
    .map((part) => /(\d+)(?:\.(\d+))?/.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2] ?? 0)] as [number, number]);
  if (mins.length === 0) return null;
  return mins.sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]!;
}

const atLeast = (a: [number, number], b: [number, number]) =>
  a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);

describe('declared Node engines', () => {
  const cliDir = path.join(root, 'packages', 'cli');
  // The published package is the repository root; packages/cli is its build package.
  const pkg = read(path.join(root, 'package.json'));
  const cli = read(path.join(cliDir, 'package.json'));

  it('is not lower than what the CLI runtime dependencies require', () => {
    const declared = minNode(pkg.engines.node)!;
    for (const dep of Object.keys(pkg.dependencies)) {
      const manifest = read(path.join(root, 'node_modules', dep, 'package.json'));
      const required = minNode(manifest.engines?.node);
      if (!required) continue;
      expect(atLeast(declared, required), `${dep} needs Node ${required.join('.')}`).toBe(true);
    }
  });

  it('is the only one: the private CLI build package adds none, and builds with the same runtime deps', () => {
    expect(cli.engines).toBeUndefined();
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(Object.keys(cli.devDependencies), dep).toContain(dep);
    }
  });
});
