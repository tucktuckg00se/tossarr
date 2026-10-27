import type { Database } from 'better-sqlite3';
import * as db from './db.js';
import { createClient } from './clients/index.js';
import { errorMessage } from './util.js';

export interface SyncResult {
  sourceId: number;
  added: number;
  updated: number;
  pruned: number;
  error?: string;
}

/** Upsert all of a source's items, prune vanished ones, stamp last_sync. */
export async function syncSource(database: Database, source: db.SourceRow): Promise<SyncResult> {
  const client = createClient({ kind: source.kind, url: source.url, apiKey: source.apiKey });
  const items = await client.listItems();
  const nowIso = new Date().toISOString();
  const { added, updated } = db.upsertItems(database, source.id, items, nowIso);
  const pruned = db.pruneItems(database, source.id, items.map((i) => `${source.id}:${i.externalId}`));
  db.setMeta(database, `last_sync:${source.id}`, nowIso);
  return { sourceId: source.id, added, updated, pruned };
}

export async function syncOne(database: Database, sourceId: number): Promise<SyncResult> {
  const source = db.getSource(database, sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);
  return syncSource(database, source);
}

/** Sync every enabled source; per-source failures are captured in the result. */
export async function syncAll(database: Database): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const source of db.listSources(database)) {
    if (!source.enabled) continue;
    try {
      results.push(await syncSource(database, source));
    } catch (err) {
      results.push({ sourceId: source.id, added: 0, updated: 0, pruned: 0, error: errorMessage(err) });
    }
  }
  return results;
}
