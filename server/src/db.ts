import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DecisionKind, ItemType, NormalizedItem, SourceKind } from './types.js';

export interface SourceRow {
  id: number;
  name: string;
  kind: SourceKind;
  url: string;
  apiKey: string;
  enabled: boolean;
}

export interface ItemRow {
  id: string;
  sourceId: number;
  type: ItemType;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
  metaJson: string | null;
  updatedAt: string;
}

/** ItemRow plus the owning source's name, as returned by deck/browse queries. */
export interface ItemWithSource extends ItemRow {
  sourceName: string;
}

export interface DecisionRow {
  itemId: string;
  decision: DecisionKind;
  confirmed: boolean;
  nextDue: string | null;
  decidedAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources(
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('sonarr','radarr')),
  url     TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items(
  id          TEXT PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  year        INTEGER,
  poster_path TEXT,
  overview    TEXT NOT NULL DEFAULT '',
  meta_json   TEXT,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);

CREATE TABLE IF NOT EXISTS decisions(
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('keep','remove')),
  confirmed  INTEGER NOT NULL DEFAULT 0,
  next_due   TEXT,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(configDir: string): Database.Database {
  mkdirSync(configDir, { recursive: true });
  const db = new Database(path.join(configDir, 'tossarr.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    db.exec(SCHEMA);
    db.pragma('user_version = 1');
  }
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

function mapSource(row: Record<string, unknown>): SourceRow & { itemCount?: number } {
  return {
    id: row.id as number,
    name: row.name as string,
    kind: row.kind as SourceKind,
    url: row.url as string,
    apiKey: row.api_key as string,
    enabled: Boolean(row.enabled),
    ...(row.itemCount !== undefined ? { itemCount: row.itemCount as number } : {}),
  };
}

export function listSources(db: Database.Database): (SourceRow & { itemCount: number })[] {
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS itemCount
       FROM sources s ORDER BY s.id`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => mapSource(r) as SourceRow & { itemCount: number });
}

export function getSource(db: Database.Database, id: number): SourceRow | null {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSource(row) : null;
}

export function createSource(
  db: Database.Database,
  input: { name: string; kind: SourceKind; url: string; apiKey: string },
): SourceRow {
  const info = db
    .prepare('INSERT INTO sources (name, kind, url, api_key) VALUES (?, ?, ?, ?)')
    .run(input.name, input.kind, input.url, input.apiKey);
  return getSource(db, Number(info.lastInsertRowid))!;
}

export function updateSource(
  db: Database.Database,
  id: number,
  patch: { name?: string; url?: string; apiKey?: string; enabled?: boolean },
): SourceRow | null {
  const current = getSource(db, id);
  if (!current) return null;
  db.prepare(
    `UPDATE sources SET
       name    = COALESCE(?, name),
       url     = COALESCE(?, url),
       api_key = COALESCE(?, api_key),
       enabled = COALESCE(?, enabled)
     WHERE id = ?`,
  ).run(patch.name ?? null, patch.url ?? null, patch.apiKey ?? null, patch.enabled === undefined ? null : (patch.enabled ? 1 : 0), id);
  return getSource(db, id);
}

export function deleteSource(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------

function mapItem(row: Record<string, unknown>): ItemRow {
  return {
    id: row.id as string,
    sourceId: row.source_id as number,
    type: row.type as ItemType,
    title: row.title as string,
    year: (row.year as number | null) ?? null,
    posterPath: (row.poster_path as string | null) ?? null,
    overview: (row.overview as string) ?? '',
    metaJson: (row.meta_json as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function getItem(db: Database.Database, id: string): ItemRow | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapItem(row) : null;
}

export function getItemWithSource(
  db: Database.Database,
  id: string,
): (ItemRow & { sourceName: string }) | null {
  const row = db
    .prepare(
      `SELECT i.*, s.name AS source_name
       FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? { ...mapItem(row), sourceName: row.source_name as string } : null;
}

/** Split a composite item id `<sourceId>:<externalId>`; null when malformed. */
export function splitItemId(itemId: string): { sourceId: number; externalId: string } | null {
  const idx = itemId.indexOf(':');
  if (idx <= 0) return null;
  const sourceId = Number(itemId.slice(0, idx));
  const externalId = itemId.slice(idx + 1);
  if (!Number.isInteger(sourceId) || externalId === '') return null;
  return { sourceId, externalId };
}

export function externalIdOf(itemId: string): string | null {
  return splitItemId(itemId)?.externalId ?? null;
}

/**
 * Insert or update every item for a source. Returns how many were new vs. updated.
 */
export function upsertItems(
  db: Database.Database,
  sourceId: number,
  items: NormalizedItem[],
  nowIso: string,
): { added: number; updated: number } {
  const insert = db.prepare(
    `INSERT INTO items (id, source_id, type, title, year, poster_path, overview, meta_json, updated_at)
     VALUES (:id, :sourceId, :type, :title, :year, :posterPath, :overview, :metaJson, :updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       type        = excluded.type,
       title       = excluded.title,
       year        = excluded.year,
       poster_path = excluded.poster_path,
       overview    = excluded.overview,
       meta_json   = excluded.meta_json,
       updated_at  = excluded.updated_at`,
  );
  const existsStmt = db.prepare('SELECT 1 FROM items WHERE id = ?');
  let added = 0;
  let updated = 0;
  const tx = db.transaction((rows: NormalizedItem[]) => {
    for (const item of rows) {
      const had = existsStmt.get(`${sourceId}:${item.externalId}`);
      insert.run({
        id: `${sourceId}:${item.externalId}`,
        sourceId,
        type: item.type,
        title: item.title,
        year: item.year,
        posterPath: item.posterPath,
        overview: item.overview,
        metaJson: JSON.stringify(item.meta),
        updatedAt: nowIso,
      });
      if (had) updated += 1;
      else added += 1;
    }
  });
  tx(items);
  return { added, updated };
}

/**
 * Delete items for a source that are no longer present upstream.
 * Confirmed removals are tombstones: they stay so the Removed list survives syncs.
 */
export function pruneItems(db: Database.Database, sourceId: number, seenIds: string[]): number {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS tossarr_seen(id TEXT PRIMARY KEY)');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tossarr_seen').run();
    const ins = db.prepare('INSERT OR IGNORE INTO tossarr_seen(id) VALUES (?)');
    for (const id of seenIds) ins.run(id);
    return db
      .prepare(
        `DELETE FROM items
         WHERE source_id = ?
           AND id NOT IN (SELECT id FROM tossarr_seen)
           AND id NOT IN (SELECT item_id FROM decisions WHERE decision = 'remove' AND confirmed = 1)`,
      )
      .run(sourceId).changes;
  });
  return tx();
}

// ---------------------------------------------------------------------------
// decisions
// ---------------------------------------------------------------------------

function mapDecision(row: Record<string, unknown>): DecisionRow {
  return {
    itemId: row.item_id as string,
    decision: row.decision as DecisionKind,
    confirmed: Boolean(row.confirmed),
    nextDue: (row.next_due as string | null) ?? null,
    decidedAt: row.decided_at as string,
  };
}

export function getDecision(db: Database.Database, itemId: string): DecisionRow | null {
  const row = db.prepare('SELECT * FROM decisions WHERE item_id = ?').get(itemId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapDecision(row) : null;
}

/**
 * Record (or replace) a decision. Re-deciding always resets confirmed to 0 —
 * a confirmed item is gone upstream and cannot be in the deck again.
 */
export function setDecision(
  db: Database.Database,
  itemId: string,
  decision: DecisionKind,
  decidedAtIso: string,
  nextDueIso?: string,
): void {
  db.prepare(
    `INSERT INTO decisions (item_id, decision, confirmed, next_due, decided_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       decision   = excluded.decision,
       confirmed  = 0,
       next_due   = excluded.next_due,
       decided_at = excluded.decided_at`,
  ).run(itemId, decision, nextDueIso ?? null, decidedAtIso);
}

export function deleteDecision(db: Database.Database, itemId: string): boolean {
  return db.prepare('DELETE FROM decisions WHERE item_id = ?').run(itemId).changes > 0;
}

export function setConfirmed(db: Database.Database, itemId: string, confirmed: boolean): void {
  db.prepare('UPDATE decisions SET confirmed = ? WHERE item_id = ?').run(confirmed ? 1 : 0, itemId);
}

/** Most recent non-confirmed decision (undo target). */
export function latestPendingDecision(db: Database.Database): DecisionRow | null {
  const row = db
    .prepare('SELECT * FROM decisions WHERE confirmed = 0 ORDER BY decided_at DESC, rowid DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  return row ? mapDecision(row) : null;
}

export function pendingRemovals(db: Database.Database): (DecisionRow & { item: ItemWithSource })[] {
  const rows = db
    .prepare(
      `SELECT d.*, i.id AS item_id, i.source_id, i.type, i.title, i.year, i.poster_path,
              i.overview, i.meta_json, i.updated_at, s.name AS source_name
       FROM decisions d
       JOIN items i ON i.id = d.item_id
       JOIN sources s ON s.id = i.source_id
       WHERE d.decision = 'remove' AND d.confirmed = 0
       ORDER BY d.decided_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({ ...mapDecision(r), item: { ...mapItem(r), sourceName: r.source_name as string } }));
}

/**
 * Items eligible for the deck: never decided, or kept and past their reappear date.
 */
export function deckBatch(
  db: Database.Database,
  filter: 'all' | ItemType,
  limit: number,
  nowIso: string,
): { items: ItemWithSource[]; totalPending: number } {
  const where = `
    FROM items i
    JOIN sources s ON s.id = i.source_id AND s.enabled = 1
    LEFT JOIN decisions d ON d.item_id = i.id
    WHERE (d.item_id IS NULL OR (d.decision = 'keep' AND d.next_due IS NOT NULL AND d.next_due <= :now))
      AND (:filter = 'all' OR i.type = :filter)`;
  const totalPending = (
    db.prepare(`SELECT COUNT(*) AS n ${where}`).get({ now: nowIso, filter }) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT i.*, s.name AS source_name ${where}
       ORDER BY RANDOM() LIMIT :limit`,
    )
    .all({ now: nowIso, filter, limit }) as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({ ...mapItem(r), sourceName: r.source_name as string })),
    totalPending,
  };
}

export function browseList(
  db: Database.Database,
  list: 'kept' | 'pending' | 'removed',
  limit: number,
  offset: number,
): (ItemWithSource & { decidedAt: string })[] {
  const where =
    list === 'kept'
      ? "d.decision = 'keep'"
      : list === 'pending'
        ? "d.decision = 'remove' AND d.confirmed = 0"
        : "d.decision = 'remove' AND d.confirmed = 1";
  const rows = db
    .prepare(
      `SELECT i.*, s.name AS source_name, d.decided_at
       FROM decisions d
       JOIN items i ON i.id = d.item_id
       JOIN sources s ON s.id = i.source_id
       WHERE ${where}
       ORDER BY d.decided_at DESC, i.title
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapItem(r),
    sourceName: r.source_name as string,
    decidedAt: r.decided_at as string,
  }));
}

/**
 * Clear all non-confirmed decisions. Confirmed removals are kept: the Removed
 * list is a log of irreversible upstream deletes and should survive resets.
 */
export function resetDecisions(db: Database.Database): number {
  return db.prepare('DELETE FROM decisions WHERE confirmed = 0').run().changes;
}

// ---------------------------------------------------------------------------
// meta (per-source sync bookkeeping)
// ---------------------------------------------------------------------------

export function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
