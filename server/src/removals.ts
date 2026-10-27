import type { Database } from 'better-sqlite3';
import * as db from './db.js';
import { createClient } from './clients/index.js';
import { errorMessage } from './util.js';

export interface RemovalOutcome {
  ok: boolean;
  itemId: string;
  /** True when the upstream resource was already gone (404). */
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Confirm a pending removal: delete upstream (metadata + files), then tombstone
 * locally. On failure the decision stays pending so it can be retried.
 */
export async function confirmRemoval(
  database: Database,
  source: db.SourceRow,
  itemId: string,
): Promise<RemovalOutcome> {
  const externalId = db.externalIdOf(itemId);
  if (externalId === null) return { ok: false, itemId, error: 'Malformed item id' };
  try {
    const client = createClient({ kind: source.kind, url: source.url, apiKey: source.apiKey });
    const alreadyGone = await client.deleteItem(externalId);
    db.setConfirmed(database, itemId, true);
    return { ok: true, itemId, alreadyGone };
  } catch (err) {
    return { ok: false, itemId, error: errorMessage(err) };
  }
}
