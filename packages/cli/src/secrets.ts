/**
 * Pre-upload check for files that probably hold secrets. Pure (no I/O) so it is easy to test.
 * Findings carry a rule name and a line number, never the matched text: the whole point is
 * that the warning itself must not leak the secret into a terminal log or a notification.
 */

export interface SecretFinding {
  /** Human name of the rule that matched, e.g. "AWS access key ID". */
  rule: string;
  kind: 'filename' | 'content';
  /** 1-based line numbers (content findings only), at most MAX_LINES_PER_RULE. */
  lines: number[];
}

/** Only the start of a file is scanned, so a huge text file costs a bounded amount of time. */
export const SCAN_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_LINES_PER_RULE = 5;

const FILENAME_RULES: { rule: string; test: RegExp }[] = [
  // `.env`, `.env.local`, `prod.env`; but not the committed templates `.env.example` and friends.
  { rule: '.env file', test: /^(?:\.env(?!\.(?:example|sample|template)$)(?:\..+)?|.+\.env)$/i },
  { rule: 'private key or certificate file (.pem, .key, .p12)', test: /\.(?:pem|key|p12)$/i },
  { rule: 'SSH private key', test: /^id_(?:rsa|dsa|ecdsa|ed25519)(?!.*\.pub$).*$/i },
  { rule: 'credentials file', test: /^credentials/i },
  { rule: 'npm or netrc credentials file', test: /^\.(?:npmrc|netrc)$/i },
  { rule: 'password database (.kdbx)', test: /\.kdbx$/i },
];

// Every pattern is linear-time (no nested quantifiers) because it runs over user content.
const CONTENT_RULES: { rule: string; test: RegExp }[] = [
  { rule: 'private key (PEM header)', test: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { rule: 'AWS access key ID', test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'GitHub token', test: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { rule: 'Slack token', test: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  // A bare `apiKey: string` in source code is not a secret; require a value that looks like one.
  { rule: 'API key assignment', test: /api[_-]?key['"]?\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{16,}/i },
];

/** Same heuristic the uploader uses for content types: no NUL byte in the first 8 KiB. */
function isText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

export function checkFilename(filename: string): SecretFinding[] {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return FILENAME_RULES.filter((r) => r.test.test(base)).map((r) => ({
    rule: r.rule,
    kind: 'filename',
    lines: [],
  }));
}

export function checkContent(bytes: Uint8Array): SecretFinding[] {
  if (!isText(bytes)) return [];
  const text = Buffer.from(bytes.subarray(0, SCAN_LIMIT_BYTES)).toString('utf8');
  const found = new Map<string, SecretFinding>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { rule, test } of CONTENT_RULES) {
      if (!test.test(line)) continue;
      let finding = found.get(rule);
      if (!finding) found.set(rule, (finding = { rule, kind: 'content', lines: [] }));
      if (finding.lines.length < MAX_LINES_PER_RULE) finding.lines.push(i + 1);
    }
  }
  return [...found.values()];
}

/** Filename rules first, then content rules in the order they were defined. */
export function findSecrets(filename: string, bytes: Uint8Array): SecretFinding[] {
  return [...checkFilename(filename), ...checkContent(bytes)];
}

/** One line per finding, e.g. `AWS access key ID (line 3)`. */
export function describeFinding(f: SecretFinding): string {
  if (f.kind === 'filename') return `file name looks like a ${f.rule}`;
  const where = f.lines.length === 1 ? 'line' : 'lines';
  return `${f.rule} (${where} ${f.lines.join(', ')})`;
}
