import { FastlinkClient } from '@r2-fastlink/core';
import { copyToClipboard } from './clipboard.ts';
import { loadConfig, type Config } from './config.ts';
import { CliError } from './errors.ts';
import { createStyle, type Style } from './format.ts';
import { History } from './history.ts';
import { readStdin, prompt } from './io.ts';

/** Everything a command needs from the outside world, so commands are easy to test. */
export interface Context {
  config: Config;
  history: History;
  style: Style;
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  now(): number;
  /** Write a line to stdout (reserved for machine-readable results such as URLs). */
  out(text: string): void;
  /** Write a line to stderr (human-readable progress and messages). */
  err(text: string): void;
  client(): FastlinkClient;
  copy(text: string): Promise<boolean>;
  readStdin(): Promise<Buffer>;
  prompt(question: string, opts?: { secret?: boolean }): Promise<string>;
}

export function createContext(env: NodeJS.ProcessEnv = process.env): Context {
  const config = loadConfig(env);
  const color = Boolean(process.stderr.isTTY) && !env.NO_COLOR;
  return {
    config,
    history: new History(),
    style: createStyle(color),
    env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    now: () => Date.now(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    client: () => clientFromConfig(config),
    copy: (text) => copyToClipboard(text, env),
    readStdin,
    prompt,
  };
}

export function clientFromConfig(config: Config): FastlinkClient {
  if (!config.endpoint || !config.token) {
    throw new CliError('r2fl is not configured yet.', 'Run `r2fl init` first.');
  }
  return new FastlinkClient(config.endpoint, config.token);
}
