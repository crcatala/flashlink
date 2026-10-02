import type { LinkInfo } from '@r2-fastlink/core';
import { readJson, writeJsonAtomic } from './fsutil.ts';
import { historyPath } from './paths.ts';

export interface HistoryEntry {
  code: string;
  url: string;
  filename: string;
  size: number;
  contentType: string;
  /** SHA-256 of the uploaded bytes; lets `refresh` verify a re-upload is the same file. */
  sha256: string;
  /** Absolute path of the source file, or null for stdin uploads. */
  sourcePath: string | null;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  maxDownloads: number | null;
  hits: number;
  lastRefreshedAt: string | null;
  /** `exhausted`: the server reported the link's download cap was reached (cleared by refresh). */
  state: 'active' | 'revoked' | 'purged' | 'exhausted';
}

export type EntryStatus = 'live' | 'exhausted' | 'expired' | 'revoked' | 'purged';

interface HistoryFile {
  version: 1;
  entries: HistoryEntry[];
}

const MAX_ENTRIES = 2000;

export function entryStatus(entry: HistoryEntry, now = Date.now()): EntryStatus {
  if (entry.state === 'purged') return 'purged';
  if (Date.parse(entry.expiresAt) > now) return entry.state === 'exhausted' ? 'exhausted' : 'live';
  return entry.state === 'revoked' ? 'revoked' : 'expired';
}

/** Local-only history of uploads, stored as one JSON file (newest last). */
export class History {
  constructor(private readonly file: string = historyPath()) {}

  list(): HistoryEntry[] {
    return readJson<HistoryFile>(this.file)?.entries ?? [];
  }

  find(code: string): HistoryEntry | undefined {
    return this.list().find((e) => e.code === code);
  }

  latest(): HistoryEntry | undefined {
    return this.list().at(-1);
  }

  /** Insert or replace by code. */
  upsert(entry: HistoryEntry): void {
    const entries = this.list().filter((e) => e.code !== entry.code);
    entries.push(entry);
    this.write(entries);
  }

  update(code: string, patch: Partial<HistoryEntry>): HistoryEntry | undefined {
    const entries = this.list();
    const index = entries.findIndex((e) => e.code === code);
    if (index === -1) return undefined;
    const updated = { ...entries[index]!, ...patch };
    entries[index] = updated;
    this.write(entries);
    return updated;
  }

  /** Fold fresh server state (from `lookup`) into the local entries. */
  applyServerState(links: Record<string, LinkInfo | null>, now = Date.now()): void {
    const entries = this.list().map((entry): HistoryEntry => {
      if (!(entry.code in links)) return entry;
      const info = links[entry.code];
      if (!info) return { ...entry, state: 'purged' };
      // The server reports `expired` for time-based expiry and for a reached download cap;
      // expired-while-still-in-window therefore means exhausted.
      const exhausted = info.expired && Date.parse(info.expiresAt) > now;
      const state: HistoryEntry['state'] = exhausted
        ? 'exhausted'
        : entry.state === 'exhausted' || entry.state === 'purged'
          ? 'active'
          : entry.state;
      return { ...entry, expiresAt: info.expiresAt, hits: info.hits, state };
    });
    this.write(entries);
  }

  private write(entries: HistoryEntry[]): void {
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
    writeJsonAtomic(this.file, { version: 1, entries: trimmed } satisfies HistoryFile);
  }
}
