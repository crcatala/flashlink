import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks for the Finder Sync spike (macos/spike, rf-og97). The Swift itself can only be
// built on a Mac; these keep the pieces that must agree with each other from drifting.
const spike = path.resolve(import.meta.dirname, '..', '..', '..', 'macos', 'spike');
const read = (rel: string): string => fs.readFileSync(path.join(spike, rel), 'utf8');

const swiftConst = (src: string, name: string): string => {
  const m = new RegExp(`static let ${name} = "([^"]+)"`).exec(src);
  if (!m?.[1]) throw new Error(`no ${name} in HandOff.swift`);
  return m[1];
};
const plistString = (src: string, key: string): string => {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(src);
  if (!m?.[1]) throw new Error(`no ${key} in plist`);
  return m[1];
};

describe('macos/spike consistency', () => {
  const handoff = read('Shared/HandOff.swift');
  const appPlist = read('App/Info.plist');
  const extPlist = read('FinderExt/Info.plist');
  const project = read('project.yml');
  const installSh = read('install.sh');

  it('registers the URL scheme the extension opens', () => {
    const scheme = swiftConst(handoff, 'scheme');
    expect(appPlist).toContain(`<string>${scheme}</string>`);
    expect(read('test-handoff.sh')).toContain(`r2fl-spike://share`);
    expect(`${scheme}://${swiftConst(handoff, 'host')}`).toBe('r2fl-spike://share');
  });

  it('is a Finder Sync extension whose principal class exists', () => {
    expect(plistString(extPlist, 'NSExtensionPointIdentifier')).toBe('com.apple.FinderSync');
    const cls = /\.([A-Za-z0-9_]+)$/.exec(plistString(extPlist, 'NSExtensionPrincipalClass'))?.[1];
    expect(cls).toBeDefined();
    expect(read('FinderExt/ShareFinderSync.swift')).toContain(`final class ${cls}: FIFinderSync`);
  });

  it('is sandboxed and asks for nothing that needs a provisioning profile', () => {
    const ent = read('FinderExt/FinderExt.entitlements');
    expect(ent).toMatch(/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/);
    expect(ent).not.toMatch(/application-groups|aps-environment|icloud|keychain-access-groups/);
    expect(read('App/Info.plist')).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
  });

  it('keeps bundle ids in step between project.yml and install.sh', () => {
    const app = /PRODUCT_BUNDLE_IDENTIFIER: (\S+)\n\s+INFOPLIST_FILE: App/.exec(project)?.[1];
    const ext = /PRODUCT_BUNDLE_IDENTIFIER: (\S+)\n\s+INFOPLIST_FILE: FinderExt/.exec(project)?.[1];
    expect(app).toBeDefined();
    expect(ext).toBe(`${app}.FinderSync`); // an extension's id must extend its host app's id
    expect(installSh).toContain(`APP_ID="${app}"`);
    expect(installSh).toContain(`EXT_ID="${ext}"`);
    expect(installSh).toContain('R2FLFinderSync.appex');
  });

  it('commits no signing material', () => {
    for (const file of [
      'project.yml',
      'run.sh',
      'README.md',
      'App/Info.plist',
      'FinderExt/Info.plist',
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/DEVELOPMENT_TEAM: ["']?[A-Z0-9]{10}/);
      expect(src, file).not.toMatch(/Developer ID|iPhone Developer|[A-Z0-9]{10}\.dev\./);
    }
    expect(project).toMatch(/CODE_SIGN_IDENTITY: ["']-["']/);
  });
});

describe('macOS spike workflow', () => {
  const workflow = fs.readFileSync(
    path.join(spike, '..', '..', '.github', 'workflows', 'macos-spike.yml'),
    'utf8',
  );

  it('runs on a GitHub-hosted Mac only for spike changes, never on the normal CI path', () => {
    expect(workflow).toMatch(/runs-on: macos-latest/);
    expect(workflow).toMatch(/paths:\s+- macos\/spike\/\*\*/);
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toMatch(/timeout-minutes: \d+/);
  });

  it('calls scripts that exist', () => {
    for (const script of workflow.match(/macos\/spike\/[\w./-]+\.(?:sh|swift)/g) ?? []) {
      expect(fs.existsSync(path.join(spike, '..', '..', script)), script).toBe(true);
    }
  });
});

describe('macos/spike/test-handoff.sh encoder', () => {
  const script = path.join(spike, 'test-handoff.sh');
  const hasPerl = spawnSync('perl', ['-e', '1']).status === 0;

  it.skipIf(!hasPerl)('produces a URL that decodes to the exact awkward file names', () => {
    const r = spawnSync('sh', [script, '--encode-only'], {
      encoding: 'utf8',
      env: { ...process.env, R2FL_SPIKE_FILES: '/tmp/r2fl dir' },
    });
    expect(r.status).toBe(0);
    const url = new URL(r.stdout.trim());
    expect(url.protocol).toBe('r2fl-spike:');
    expect(url.host).toBe('share');
    expect(url.search).not.toContain(' ');
    const pairs = url.search
      .slice(1)
      .split('&')
      .map((kv) => kv.split('=') as [string, string]);
    expect(pairs[0]).toEqual(['ttl', '1h']);
    const paths = pairs.slice(1).map(([k, v]) => {
      expect(k).toBe('path');
      return decodeURIComponent(v);
    });
    expect(paths).toEqual([
      '/tmp/r2fl dir/plain.txt',
      '/tmp/r2fl dir/with space.txt',
      `/tmp/r2fl dir/quote"s and 'single'.txt`,
      '/tmp/r2fl dir/-leading-dash.txt',
      '/tmp/r2fl dir/ünïcödé 日本語 🚀.txt',
      '/tmp/r2fl dir/a&b=c+d%20e#f?g.txt',
    ]);
  });
});
