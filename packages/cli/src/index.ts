import { ApiError } from '@r2-fastlink/core';
import { Command, InvalidArgumentError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { configGet, configSet, configShow } from './commands/config.ts';
import { init } from './commands/init.ts';
import { ls } from './commands/ls.ts';
import { refresh } from './commands/refresh.ts';
import { revoke } from './commands/revoke.ts';
import { status } from './commands/status.ts';
import { up } from './commands/up.ts';
import { createContext, type Context } from './context.ts';
import { CliError } from './errors.ts';
import { configPath } from './paths.ts';

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer.');
  return n;
}

function buildProgram(ctx: () => Context): Command {
  const program = new Command('r2fl')
    .description('Upload a file and get a short link that expires on its own.')
    .version(pkg.version)
    .showHelpAfterError('(run with --help for usage)');

  program
    .command('init')
    .description('Save your Worker URL and upload token, and verify them')
    .option('-e, --endpoint <url>', 'Worker URL, e.g. https://fl.example.com')
    .option('-k, --token <token>', 'upload token (or set R2FL_TOKEN)')
    .option('-t, --ttl <duration>', 'default link lifetime, e.g. 1h')
    .option('--no-verify', 'save without contacting the server')
    .action((opts) => init(opts, ctx()));

  program
    .command('up [files...]')
    .alias('upload')
    .description('Upload files (or stdin) and print a short link for each')
    .option('-t, --ttl <duration>', 'link lifetime: 30m, 2h, 1d… (default: your config, 1h)')
    .option('-d, --max-downloads <n>', 'stop serving after n downloads', positiveInt)
    .option('-n, --name <filename>', 'filename to use (required-ish for stdin)')
    .option('--with-name', 'append the filename to the URL')
    .option('--json', 'print the full result as JSON')
    .option('--no-copy', 'do not copy the URL to the clipboard')
    .option('-q, --quiet', 'print only URLs')
    .action((files: string[], opts) => up(files, opts, ctx()));

  program
    .command('refresh [link]')
    .description('Re-open a link for another window, keeping the same short URL')
    .option('-t, --ttl <duration>', 'new lifetime from now (default: your config)')
    .option('--json', 'print the result as JSON')
    .option('--no-copy', 'do not copy the URL to the clipboard')
    .action((link: string | undefined, opts) => refresh(link, opts, ctx()));

  program
    .command('revoke <link>')
    .description('Close a link right now (it can be refreshed later)')
    .option('--purge', 'also delete the stored file immediately')
    .action((link: string, opts) => revoke(link, opts, ctx()));

  program
    .command('ls')
    .alias('list')
    .description('Show your local upload history')
    .option('-n, --limit <n>', 'how many entries to show (default 20)', positiveInt)
    .option('-a, --all', 'show every entry')
    .option('-l, --live', 'only links that are currently live')
    .option('-s, --sync', 'refresh status and hit counts from the server first')
    .option('--json', 'print as JSON')
    .action((opts) => ls(opts, ctx()));

  program
    .command('status')
    .description("Show the server's limits and current usage")
    .option('--json', 'print as JSON')
    .action((opts) => status(opts, ctx()));

  const config = program.command('config').description('View or change settings');
  config.action(() => configShow(ctx()));
  config
    .command('get <key>')
    .description('Print one setting')
    .action((key: string) => configGet(key, ctx()));
  config
    .command('set <key> <value>')
    .description('Change a setting (endpoint, token, defaultTtl, maxFileBytes, copy)')
    .action((key: string, value: string) => configSet(key, value, ctx()));
  config
    .command('path')
    .description('Print the config file path')
    .action(() => console.log(configPath()));

  return program;
}

async function main(): Promise<void> {
  let context: Context | undefined;
  const ctx = () => (context ??= createContext());
  try {
    await buildProgram(ctx).parseAsync(process.argv);
  } catch (err) {
    const color = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
    const red = (s: string) => (color ? `\u001b[31m${s}\u001b[39m` : s);
    if (err instanceof CliError) {
      process.stderr.write(`${red('error:')} ${err.message}\n`);
      if (err.hint) process.stderr.write(`${err.hint}\n`);
    } else if (err instanceof ApiError) {
      process.stderr.write(`${red('error:')} ${err.message}\n`);
      if (err.status === 401) process.stderr.write('Check your token with `r2fl init`.\n');
    } else if (err instanceof Error && err.message === 'Cancelled') {
      process.stderr.write('\n');
    } else {
      process.stderr.write(
        `${red('error:')} ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exitCode = 1;
  }
}

await main();
