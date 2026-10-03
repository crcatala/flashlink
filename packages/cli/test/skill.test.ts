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

/**
 * Every `r2fl <word> ...` inside a fenced block or an inline code span (prose such as "r2fl is
 * not configured" is not a command), with the short and long options that follow it. A snippet
 * ends at a pipe, `;`, `)`, a backtick, a `#` comment or a `--` terminator.
 */
function invocations(markdown: string): { command: string; options: string[]; snippet: string }[] {
  const code = [
    ...[...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]!),
    ...[...markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '').matchAll(/`([^`\n]+)`/g)].map(
      (m) => m[1]!,
    ),
  ].join('\n');
  const found: { command: string; options: string[]; snippet: string }[] = [];
  for (const m of code.matchAll(/(?<![\w-])r2fl ([a-z][\w-]*)([^\n|;)`]*)/g)) {
    const rest = m[2]!.split(/ # | -- /)[0]!;
    const options = [...rest.matchAll(/(?<=\s)(--?[a-zA-Z][\w-]*)(?=[\s=]|$)/g)].map((o) => o[1]!);
    found.push({ command: m[1]!, options, snippet: m[0]!.trim() });
  }
  return found;
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
    // Command names (with aliases) as the real program lists them, whatever they are called.
    const commands = new Set<string>();
    for (const m of help()
      .split('Commands:')[1]!
      .matchAll(/^ {2}([a-z|-]+)(?: |$)/gm)) {
      for (const name of m[1]!.split('|')) commands.add(name);
    }
    expect(commands).toContain('up');

    const used = invocations(text);
    expect(new Set(used.map((u) => u.command))).toEqual(
      new Set(['up', 'refresh', 'revoke', 'ls', 'status', 'config', 'init']),
    );
    const optionsOf = new Map<string, Set<string>>();
    for (const { command, options, snippet } of used) {
      expect(commands, `unknown command in: ${snippet}`).toContain(command);
      if (!optionsOf.has(command)) {
        // Exactly the option tokens commander prints: `-t, --ttl <duration>`, `--no-copy`.
        const tokens = help(command).matchAll(/^ {2}((?:-[a-zA-Z], )?--?[\w-]+)/gm);
        optionsOf.set(command, new Set([...tokens].flatMap((t) => t[1]!.split(', '))));
      }
      for (const option of options) {
        expect(optionsOf.get(command), `${option} in: ${snippet}`).toContain(option);
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
