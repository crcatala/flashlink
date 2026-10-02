import os from 'node:os';
import path from 'node:path';

type Env = Record<string, string | undefined>;

/** Config directory: $R2FL_CONFIG_DIR, else $XDG_CONFIG_HOME/r2fl, else ~/.config/r2fl. */
export function configDir(env: Env = process.env): string {
  if (env.R2FL_CONFIG_DIR) return env.R2FL_CONFIG_DIR;
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'r2fl');
}

/** Data directory: $R2FL_DATA_DIR, else $XDG_DATA_HOME/r2fl, else ~/.local/share/r2fl. */
export function dataDir(env: Env = process.env): string {
  if (env.R2FL_DATA_DIR) return env.R2FL_DATA_DIR;
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'r2fl');
}

export const configPath = (env: Env = process.env) => path.join(configDir(env), 'config.json');
export const historyPath = (env: Env = process.env) => path.join(dataDir(env), 'history.json');
