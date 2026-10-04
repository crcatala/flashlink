import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractCode } from '../src/code.ts';
import { configGet, configSet, configShow } from '../src/commands/config.ts';
import { init } from '../src/commands/init.ts';
import { status } from '../src/commands/status.ts';
import { loadConfig, maskToken, parseConfigValue, saveConfig } from '../src/config.ts';
import { clock, formatBytes, parseSize, table, timeLeft, truncate } from '../src/format.ts';
import { configDir, dataDir } from '../src/paths.ts';
import { ENDPOINT, makeHarness, type Harness } from './harness.ts';

describe('extractCode', () => {
  it.each([
    ['k3F9xQ2m', 'k3F9xQ2m'],
    ['  k3F9xQ2m\n', 'k3F9xQ2m'],
    ['https://fl.example.com/k3F9xQ2m', 'k3F9xQ2m'],
    ['https://fl.example.com/k3F9xQ2m/shot.png?x=1', 'k3F9xQ2m'],
  ])('%s', (input, code) => expect(extractCode(input)).toBe(code));

  it.each(['', 'short', 'https://fl.example.com/', 'https://fl.example.com/api/links', '0OIl0OIl'])(
    'rejects %j',
    (input) => expect(() => extractCode(input)).toThrow(/not a link code/),
  );
});

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('parses sizes', () => {
    expect(parseSize('50MB')).toBe(50 * 1024 * 1024);
    expect(parseSize('512k')).toBe(512 * 1024);
    expect(parseSize('1.5GB')).toBe(1.5 * 1024 ** 3);
    expect(parseSize('1000')).toBe(1000);
    for (const bad of ['', 'MB', '-5', '0', 'abc']) expect(() => parseSize(bad)).toThrow();
  });

  it('describes time left', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeLeft('2026-01-01T12:34:00Z', now)).toBe('34m left');
    expect(timeLeft('2026-01-01T10:00:00Z', now)).toBe('expired 2h ago');
  });

  it('formats clock times', () => {
    const now = new Date(2026, 0, 1, 12, 0);
    expect(clock(new Date(2026, 0, 1, 14, 5).toISOString(), now)).toMatch(/14:05|2:05/);
    expect(clock(new Date(2026, 0, 3, 14, 5).toISOString(), now)).toMatch(/Jan/);
  });

  it('aligns tables ignoring ANSI codes', () => {
    const out = table([
      ['\u001b[1mA\u001b[22m', 'B'],
      ['longer', 'x'],
    ]);
    expect(out.split('\n').map((l) => l.replace(/\u001b\[[0-9;]*m/g, ''))).toEqual([
      'A       B',
      'longer  x',
    ]);
  });

  it('truncates by code point', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('paths', () => {
  it('honors overrides then XDG then home', () => {
    expect(configDir({ FLASHLINK_CONFIG_DIR: '/c' })).toBe('/c');
    expect(configDir({ XDG_CONFIG_HOME: '/x' })).toBe('/x/flashlink');
    expect(dataDir({ FLASHLINK_DATA_DIR: '/d' })).toBe('/d');
    expect(dataDir({ XDG_DATA_HOME: '/x' })).toBe('/x/flashlink');
    expect(configDir({})).toMatch(/\.config\/flashlink$/);
    expect(dataDir({})).toMatch(/\.local\/share\/flashlink$/);
  });
});

describe('config', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('saves with owner-only permissions and layers env overrides on top', () => {
    const env = h.ctx.env;
    saveConfig({ endpoint: 'https://a.example', token: 'tok-from-file', defaultTtl: '2h' }, env);
    const file = path.join(env.FLASHLINK_CONFIG_DIR!, 'config.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadConfig(env)).toMatchObject({
      endpoint: 'https://a.example',
      defaultTtl: '2h',
      copy: true,
    });
    expect(
      loadConfig({ ...env, FLASHLINK_TOKEN: 'tok-from-env', FLASHLINK_TTL: '5m' }),
    ).toMatchObject({
      token: 'tok-from-env',
      defaultTtl: '5m',
    });
    // Env overrides are never written back to the file.
    saveConfig({ copy: false }, { ...env, FLASHLINK_TOKEN: 'tok-from-env' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).token).toBe('tok-from-file');
  });

  it('validates values', () => {
    expect(parseConfigValue('endpoint', 'https://fl.example.com/')).toEqual({
      endpoint: 'https://fl.example.com',
    });
    expect(() => parseConfigValue('endpoint', 'ftp://x')).toThrow(/https/);
    expect(() => parseConfigValue('endpoint', 'nope')).toThrow(/valid URL/);
    expect(() => parseConfigValue('token', 'x')).toThrow(/too short/);
    expect(parseConfigValue('defaultTtl', '30m')).toEqual({ defaultTtl: '30m' });
    expect(() => parseConfigValue('defaultTtl', 'forever')).toThrow();
    expect(parseConfigValue('maxFileBytes', '10MB')).toEqual({ maxFileBytes: 10 * 1024 * 1024 });
    expect(() => parseConfigValue('maxFileBytes', '200MB')).toThrow(/100MB/);
    expect(parseConfigValue('copy', 'off')).toEqual({ copy: false });
    expect(() => parseConfigValue('copy', 'maybe')).toThrow(/copy must be true or false/);
    expect(parseConfigValue('warnSecrets', 'false')).toEqual({ warnSecrets: false });
    expect(parseConfigValue('warnSecrets', 'ON')).toEqual({ warnSecrets: true });
    expect(() => parseConfigValue('warnSecrets', 'maybe')).toThrow(/warnSecrets must be/);
  });

  it('warnSecrets defaults to true, persists, and is listed by `config`', () => {
    expect(loadConfig(h.ctx.env).warnSecrets).toBe(true);
    configSet('warnSecrets', 'off', h.ctx);
    h.ctx.config = loadConfig(h.ctx.env);
    expect(h.ctx.config.warnSecrets).toBe(false);
    configGet('warnSecrets', h.ctx);
    expect(h.stdout).toEqual(['false']);
    configShow(h.ctx);
    expect(h.stdout.join('\n')).toMatch(/warnSecrets\s+false/);
  });

  it('masks tokens', () => {
    expect(maskToken(undefined)).toBe('(not set)');
    expect(maskToken('short')).toBe('********');
    expect(maskToken('abcd1234efgh5678')).toBe('abcd…5678');
  });

  it('config set/get round-trips and rejects unknown keys', () => {
    configSet('defaultTtl', '3h', h.ctx);
    expect(loadConfig(h.ctx.env).defaultTtl).toBe('3h');
    h.ctx.config = loadConfig(h.ctx.env);
    configGet('defaultTtl', h.ctx);
    expect(h.stdout).toEqual(['3h']);
    expect(() => configGet('nope', h.ctx)).toThrow(/Unknown setting/);
    expect(() => configSet('nope', 'x', h.ctx)).toThrow(/Unknown setting/);
  });
});

describe('init and status', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ endpoint: undefined, token: undefined });
    // init is exercised through the fake server by pointing the client factory at it.
  });
  afterEach(() => h.cleanup());

  it('verifies against the server and saves on success', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = h.server.fetch as typeof fetch;
    try {
      await init({ endpoint: ENDPOINT, token: 'secret-token', ttl: '2h' }, h.ctx);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(loadConfig(h.ctx.env)).toMatchObject({
      endpoint: ENDPOINT,
      token: 'secret-token',
      defaultTtl: '2h',
    });
    expect(h.stderr.join('\n')).toContain('Connected to https://fl.test');
  });

  it('does not save a token the server rejects', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = h.server.fetch as typeof fetch;
    try {
      await expect(init({ endpoint: ENDPOINT, token: 'wrong-token' }, h.ctx)).rejects.toThrow(
        /rejected that token/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fs.existsSync(path.join(h.ctx.env.FLASHLINK_CONFIG_DIR!, 'config.json'))).toBe(false);
  });

  it('--no-verify saves without a network call; missing input fails when not a TTY', async () => {
    await init({ endpoint: ENDPOINT, token: 'whatever-token', verify: false }, h.ctx);
    expect(h.server.requests).toHaveLength(0);
    expect(loadConfig(h.ctx.env).token).toBe('whatever-token');
    const bare = makeHarness({ endpoint: undefined, token: undefined });
    await expect(init({}, bare.ctx)).rejects.toThrow(/Missing --endpoint/);
    bare.cleanup();
  });

  it('status prints limits and usage', async () => {
    const ok = makeHarness();
    await status({}, ok.ctx);
    const text = ok.stdout.join('\n');
    expect(text).toContain('max file size');
    expect(text).toContain('50 MB');
    expect(text).toContain('7d');
    ok.cleanup();
  });
});
