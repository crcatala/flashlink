import os from 'node:os';
import path from 'node:path';

type Env = Record<string, string | undefined>;

/** Config directory: $FLASHLINK_CONFIG_DIR, else $XDG_CONFIG_HOME/flashlink, else ~/.config/flashlink. */
export function configDir(env: Env = process.env): string {
  if (env.FLASHLINK_CONFIG_DIR) return env.FLASHLINK_CONFIG_DIR;
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'flashlink');
}

/** Data directory: $FLASHLINK_DATA_DIR, else $XDG_DATA_HOME/flashlink, else ~/.local/share/flashlink. */
export function dataDir(env: Env = process.env): string {
  if (env.FLASHLINK_DATA_DIR) return env.FLASHLINK_DATA_DIR;
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'flashlink');
}

export const configPath = (env: Env = process.env) => path.join(configDir(env), 'config.json');
export const historyPath = (env: Env = process.env) => path.join(dataDir(env), 'history.json');
