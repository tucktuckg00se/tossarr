import type { Item } from './types.js';
import type { ItemRow } from './db.js';
import { externalIdOf } from './db.js';

/** Map a DB row (with source name) to the API item shape. */
export function toItem(row: ItemRow & { sourceName: string }): Item {
  let meta: Record<string, unknown> = {};
  if (row.metaJson !== null) {
    try {
      meta = JSON.parse(row.metaJson) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    type: row.type,
    title: row.title,
    year: row.year,
    posterUrl: `/api/posters/${row.sourceId}/${externalIdOf(row.id) ?? ''}`,
    overview: row.overview,
    meta,
  };
}
