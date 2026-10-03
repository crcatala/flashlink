import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const SKILL = path.join(root, 'skills', 'r2-fastlink', 'SKILL.md');
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const text = fs.readFileSync(SKILL, 'utf8');

/** `--help` of the real program, so the skill is checked against what the CLI accepts. */
function help(...args: string[]): string {
  const res = spawnSync(process.execPath, ['--import', 'tsx', ENTRY, ...args, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, R2FL_CONFIG_DIR: path.join(root, 'no-such-config-dir') },
  });
  expect(res.status).toBe(0);
  return res.stdout;
}

describe('skills/r2-fastlink/SKILL.md', () => {
  it('has the frontmatter a skill loader needs, and the name matches its folder', () => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(match).not.toBeNull();
    const fields = Object.fromEntries(
      match![1]!
        .split('\n')
        .map((line) => [
          line.slice(0, line.indexOf(':')),
          line.slice(line.indexOf(':') + 1).trim(),
        ]),
    );
    expect(fields.name).toBe(path.basename(path.dirname(SKILL)));
    expect(fields.name).toBe('r2-fastlink');
    expect(fields.description!.length).toBeGreaterThan(40);
    expect(fields.description!.length).toBeLessThanOrEqual(1024);
  });

  it('only shows r2fl commands and options that exist', () => {
    const programHelp = help();
    const helpFor: Record<string, string> = {};
    const used = new Map<string, Set<string>>();
    // Every line inside a code block or span that starts with (or pipes into) `r2fl <command>`.
    for (const m of text.matchAll(
      /\br2fl (up|refresh|revoke|ls|status|config|init)\b([^\n`|;)]*)/g,
    )) {
      const command = m[1]!;
      const flags = used.get(command) ?? new Set<string>();
      for (const flag of m[2]!.matchAll(/(?<=\s)(--[a-z][a-z-]*)/g)) flags.add(flag[1]!);
      used.set(command, flags);
    }
    expect([...used.keys()].sort()).toEqual(
      expect.arrayContaining(['up', 'refresh', 'revoke', 'ls', 'status']),
    );
    for (const [command, flags] of used) {
      expect(programHelp).toContain(command);
      helpFor[command] = help(command);
      for (const flag of flags) {
        // `--no-copy` is documented by commander as `--no-copy`; `--exclude` as `-x, --exclude`.
        expect(helpFor[command], `${command} ${flag}`).toContain(flag);
      }
    }
  });

  it('keeps the rules an agent must not miss', () => {
    expect(text).toMatch(/public to anyone who has the URL/);
    expect(text).toMatch(/Do not pass `--allow-secrets`/);
    expect(text).toMatch(/token is not scoped/i);
    expect(text).toMatch(/stdout is the URL and nothing else/);
    expect(text).toMatch(/R2FL_TOKEN/);
  });
});
