// The registry's sweeper alarm goes through one scheduler that keeps runs at least a minute apart
// (Registry.scheduleAlarm). A setAlarm() anywhere else could loop and bill without that limit, so this fails CI if a
// direct call appears outside the methods below. It reads names, not types, so `storage['setAlarm']` or an aliased
// method would slip past: don't. To allow a new call, route it through the scheduler instead, or add it below saying
// what bounds it. Runs in node (vitest.tooling.config.ts, tsconfig.node.json), not in the Workers pool.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** "file#method" → the alarm calls it may make. */
const ALLOWED: Record<string, string[]> = {
  'registry.ts#scheduleAlarm': ['setAlarm'],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** The name of the method or function a node sits in, or "constructor" / "<top level>". */
function enclosing(node: ts.Node): string {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isConstructorDeclaration(n)) return 'constructor';
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name)
      return n.name.getText();
  }
  return '<top level>';
}

function alarmCalls() {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (name === 'setAlarm' || name === 'deleteAlarm') {
          found.push(`${relative(SRC, file).split(sep).join('/')}#${enclosing(node)}: ${name}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe('Durable Object alarms', () => {
  it('are only set or cleared by the allowed methods', () => {
    const stray = alarmCalls().filter((call) => {
      const [where, name] = call.split(': ');
      return !ALLOWED[where!]?.includes(name!);
    });
    expect(
      stray,
      'Schedule alarms through Registry.scheduleAlarm (see test/tooling/alarmCalls.test.ts)',
    ).toEqual([]);
  });

  it("finds the calls it is guarding (so a refactor can't make this test pass vacuously)", () => {
    expect(alarmCalls()).toContain('registry.ts#scheduleAlarm: setAlarm');
  });
});
