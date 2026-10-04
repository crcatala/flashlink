export const RELEASE_VERSION: RegExp;
export function isReleaseVersion(version: string): boolean;
export function setPackageVersion(text: string, version: string): string;
export function changelogSection(markdown: string, version: string): string | null;
export interface PublishState {
  cliVersion: string;
  rootVersion: string;
  branch: string;
  clean: boolean;
  tagsAtHead: string[];
  headCommit: string | null;
  /** Commit the tag points to on origin: null = no such tag, undefined = could not ask. */
  remoteTagCommit: string | null | undefined;
  publishedOnNpm: boolean | null;
  npmUser: string | null;
  dryRun: boolean;
}
export function publishProblems(state: PublishState): string[];
export function parseRemoteTagCommit(lsRemoteOutput: string, tag: string): string | null;
export function gitState(
  cwd: string,
  tag: string,
): Pick<PublishState, 'branch' | 'clean' | 'headCommit' | 'tagsAtHead' | 'remoteTagCommit'>;
