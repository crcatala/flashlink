import readline from 'node:readline/promises';

export async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Ask a question on stderr; with `secret`, typed characters are not echoed. */
export async function prompt(question: string, opts: { secret?: boolean } = {}): Promise<string> {
  if (!opts.secret) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(question);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          return resolve(value.trim());
        }
        if (ch === '\u0003') {
          finish();
          return reject(new Error('Cancelled'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
