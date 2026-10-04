export function setPackageVersion(text: string, version: string): string;
export function changelogSection(markdown: string, version: string): string | null;
export interface PublishState {
  cliVersion: string;
  rootVersion: string;
  branch: string;
  clean: boolean;
  tagsAtHead: string[];
  tagOnRemote: boolean | null;
  publishedOnNpm: boolean | null;
  npmUser: string | null;
  dryRun: boolean;
}
export function publishProblems(state: PublishState): string[];
