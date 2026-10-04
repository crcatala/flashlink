// Types for setup-lib.mjs (used by the tests; the script itself is plain JavaScript).
export const TOKEN_SECRET: string;
export const LIFECYCLE_RULE: string;
export const LIFECYCLE_PREFIX: string;
export const LIFECYCLE_DAYS: number;
export interface SetupOptions {
  dryRun: boolean;
  rotateToken: boolean;
  help: boolean;
}
export class SetupError extends Error {
  hint?: string;
  constructor(message: string, hint?: string);
}
export function parseSetupArgs(argv: string[]): { opts: SetupOptions; help: string };
export function parseWranglerNames(jsonc: string): { worker: string; bucket: string };
export function isAuthenticated(whoamiOutput: string): boolean;
export function parseSecretNames(output: string): string[] | null;
export function hasLifecycleRule(listOutput: string, rule?: string): boolean;
export function findWorkerUrl(deployOutput: string, worker: string): string | null;
export function summary(input: {
  url: string | null;
  token: string | null;
  keptToken: boolean;
}): string;
export interface WranglerResult {
  code: number;
  stdout: string;
}
export interface SetupIo {
  readWranglerConfig(): string;
  wrangler(
    args: string[],
    options: { input?: string; echo?: boolean; quiet?: boolean },
  ): Promise<WranglerResult>;
  randomToken(): string;
  log(line: string): void;
  err(line: string): void;
}
export function runSetup(
  opts: SetupOptions,
  io: SetupIo,
): Promise<{ dryRun: boolean; url?: string | null; token?: string | null }>;
