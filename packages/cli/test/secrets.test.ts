import { describe, expect, it } from 'vitest';
import {
  SCAN_LIMIT_BYTES,
  checkContent,
  checkFilename,
  describeFinding,
  findSecrets,
} from '../src/secrets.ts';

const b = (s: string) => Buffer.from(s);

describe('filename rules', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'prod.env',
    'server.pem',
    'tls.key',
    'cert.p12',
    'id_rsa',
    'id_ed25519',
    'id_ecdsa',
    'id_rsa_work',
    'credentials',
    'credentials.json',
    '.npmrc',
    '.netrc',
    'vault.kdbx',
    '/home/me/.ssh/id_rsa',
    'DEPLOY.PEM',
  ])('flags %s', (name) => expect(checkFilename(name)).not.toHaveLength(0));

  it.each([
    'notes.txt',
    'environment.md',
    'env.txt',
    '.env.example',
    '.env.sample',
    '.env.template',
    'id_rsa.pub',
    'id_ed25519.pub',
    'keyboard.png',
    'monkey.txt',
    'my-credentials-howto.md',
    'npmrc.txt',
    'report.pdf',
  ])('does not flag %s', (name) => expect(checkFilename(name)).toEqual([]));
});

describe('content rules', () => {
  const cases: [string, string, string][] = [
    ['private key header', '-----BEGIN PRIVATE KEY-----', 'private key (PEM header)'],
    ['RSA key header', '-----BEGIN RSA PRIVATE KEY-----', 'private key (PEM header)'],
    ['OpenSSH key header', '-----BEGIN OPENSSH PRIVATE KEY-----', 'private key (PEM header)'],
    ['encrypted key header', '-----BEGIN ENCRYPTED PRIVATE KEY-----', 'private key (PEM header)'],
    ['AWS access key', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'AWS access key ID'],
    ['AWS temporary key', 'ASIAIOSFODNN7EXAMPLE', 'AWS access key ID'],
    ['GitHub PAT', `token: ghp_${'a1B2'.repeat(9)}`, 'GitHub token'],
    ['GitHub OAuth token', `gho_${'x'.repeat(36)}`, 'GitHub token'],
    ['fine-grained PAT', `github_pat_${'A1_'.repeat(10)}`, 'GitHub token'],
    ['Slack bot token', 'xoxb-1234567890-abcdefghij', 'Slack token'],
    ['api key (env style)', 'API_KEY=sk_live_abcdef0123456789', 'API key assignment'],
    ['api key (json)', '{"apiKey": "abcdef0123456789abcd"}', 'API key assignment'],
    ['api-key (yaml)', 'api-key: abcdef0123456789abcd', 'API key assignment'],
  ];
  it.each(cases)('matches %s', (_name, text, rule) => {
    const [finding] = checkContent(b(`first line\n${text}\n`));
    expect(finding).toMatchObject({ rule, kind: 'content', lines: [2] });
  });

  it.each([
    'just some notes',
    '-----BEGIN CERTIFICATE-----',
    '-----BEGIN PUBLIC KEY-----',
    'AKIA is a prefix',
    'AKIAshort',
    'ghp_tooshort',
    'github_pat_short',
    'xoxb-short',
    'apiKey: string;',
    'const apiKey = config.apiKey;',
    'api_key = ""',
    'api_key=short',
  ])('does not match %j', (text) => expect(checkContent(b(text))).toEqual([]));

  it('never echoes the matched value', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const text = `x=${secret}\n-----BEGIN PRIVATE KEY-----\napi_key=abcdef0123456789abcd\n`;
    const findings = findSecrets('cfg.txt', b(text));
    expect(findings.length).toBeGreaterThan(1);
    const shown = JSON.stringify(findings) + findings.map(describeFinding).join('\n');
    expect(shown).not.toContain(secret);
    expect(shown).not.toContain('abcdef0123456789abcd');
    expect(shown).not.toContain('BEGIN PRIVATE KEY');
  });

  it('groups lines per rule and caps them', () => {
    const text = Array.from({ length: 9 }, () => 'AKIAIOSFODNN7EXAMPLE').join('\n');
    const [finding] = checkContent(b(text));
    expect(finding!.lines).toEqual([1, 2, 3, 4, 5]);
    expect(describeFinding(finding!)).toBe('AWS access key ID (lines 1, 2, 3, 4, 5)');
  });

  it('skips binary files entirely', () => {
    const bin = Buffer.concat([Buffer.from([0x89, 0, 1]), b('AKIAIOSFODNN7EXAMPLE')]);
    expect(checkContent(bin)).toEqual([]);
  });

  it('only scans the first few MB', () => {
    const filler = b('x'.repeat(SCAN_LIMIT_BYTES) + '\n');
    expect(checkContent(Buffer.concat([filler, b('AKIAIOSFODNN7EXAMPLE')]))).toEqual([]);
    expect(checkContent(Buffer.concat([b('AKIAIOSFODNN7EXAMPLE\n'), filler]))).toHaveLength(1);
  });

  it('handles Windows line endings and long lines quickly', () => {
    expect(checkContent(b('a\r\nAKIAIOSFODNN7EXAMPLE\r\n'))[0]!.lines).toEqual([2]);
    const start = Date.now();
    checkContent(b('api_key='.repeat(100_000)));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('findSecrets', () => {
  it('combines filename and content findings and describes them', () => {
    const findings = findSecrets('.env', b('AWS=AKIAIOSFODNN7EXAMPLE'));
    expect(findings.map(describeFinding)).toEqual([
      'file name looks like a .env file',
      'AWS access key ID (line 1)',
    ]);
  });

  it('finds nothing in an ordinary file', () => {
    expect(findSecrets('notes.txt', b('hello world'))).toEqual([]);
  });
});
