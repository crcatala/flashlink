import { spawn } from 'node:child_process';

function candidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[][] {
  if (platform === 'darwin') return [['pbcopy']];
  const list: string[][] = [];
  if (env.WAYLAND_DISPLAY) list.push(['wl-copy']);
  if (env.DISPLAY)
    list.push(['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']);
  return list;
}

function tryCopy(command: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd!, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.on('error', () => resolve(false));
    child.stdin.end(text);
  });
}

/** Best-effort clipboard copy. Returns false (silently) when no tool is available. */
export async function copyToClipboard(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  for (const command of candidates(env, platform)) {
    if (await tryCopy(command, text)) return true;
  }
  return false;
}
