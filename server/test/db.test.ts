import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../src/db.js';
import type { NormalizedItem } from '../src/types.js';
import { disposeDb, freshDb } from './helpers.js';

const NOW = '2026-10-27T12:00:00.000Z';

function item(externalId: string, type: NormalizedItem['type'], title?: string): NormalizedItem {
  return { externalId, type, title: title ?? `Title ${externalId}`, year: null, posterPath: null, overview: '', meta: {} };
}

let conn: Database;
let dir: string;

beforeEach(() => {
  ({ db: conn, dir } = freshDb());
});
afterEach(() => disposeDb(conn, dir));

function addSource(name = 'TV', kind: 'sonarr' | 'radarr' = 'sonarr'): number {
  return db.createSource(conn, { name, kind, url: 'http://localhost:1', apiKey: 'key' }).id;
}

describe('upsertItems', () => {
  it('adds new items with composite ids', () => {
    const sourceId = addSource();
    const res = db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'movie')], NOW);
    expect(res).toEqual({ added: 2, updated: 0 });

    const row = db.getItem(conn, `${sourceId}:1`);
    expect(row?.title).toBe('Title 1');
    expect(row?.type).toBe('show');
    expect(row?.updatedAt).toBe(NOW);
  });

  it('counts updates on re-sync and refreshes fields', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show', 'Old')], NOW);
    const res = db.upsertItems(conn, sourceId, [item('1', 'show', 'New'), item('2', 'movie')], NOW);
    expect(res).toEqual({ added: 1, updated: 1 });
    expect(db.getItem(conn, `${sourceId}:1`)?.title).toBe('New');
  });

  it('preserves existing decisions across upserts', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW, '2027-01-01T00:00:00.000Z');
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    expect(db.getDecision(conn, `${sourceId}:1`)?.decision).toBe('keep');
  });

  it('scopes items per source (same external id, different source)', () => {
    const a = addSource('A');
    const b = addSource('B', 'radarr');
    db.upsertItems(conn, a, [item('1', 'show')], NOW);
    db.upsertItems(conn, b, [item('1', 'movie')], NOW);
    expect(db.getItem(conn, `${a}:1`)?.type).toBe('show');
    expect(db.getItem(conn, `${b}:1`)?.type).toBe('movie');
  });
});

describe('pruneItems', () => {
  it('deletes items no longer seen upstream and returns the count', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show')], NOW);
    const pruned = db.pruneItems(conn, sourceId, [`${sourceId}:1`]);
    expect(pruned).toBe(1);
    expect(db.getItem(conn, `${sourceId}:1`)).not.toBeNull();
    expect(db.getItem(conn, `${sourceId}:2`)).toBeNull();
  });

  it('keeps tombstoned items (confirmed removals) even when unseen', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:2`, 'remove', NOW);
    db.setConfirmed(conn, `${sourceId}:2`, true);
    const pruned = db.pruneItems(conn, sourceId, [`${sourceId}:1`]);
    expect(pruned).toBe(0);
    expect(db.getItem(conn, `${sourceId}:2`)).not.toBeNull();
  });

  it('does not touch other sources', () => {
    const a = addSource('A');
    const b = addSource('B', 'radarr');
    db.upsertItems(conn, a, [item('1', 'show')], NOW);
    db.upsertItems(conn, b, [item('1', 'movie')], NOW);
    const pruned = db.pruneItems(conn, a, []);
    expect(pruned).toBe(1);
    expect(db.getItem(conn, `${b}:1`)).not.toBeNull();
  });
});

describe('decisions', () => {
  it('records and reads back a decision', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW, '2027-01-01T00:00:00.000Z');
    const d = db.getDecision(conn, `${sourceId}:1`);
    expect(d).toEqual({
      itemId: `${sourceId}:1`,
      decision: 'keep',
      confirmed: false,
      nextDue: '2027-01-01T00:00:00.000Z',
      decidedAt: NOW,
    });
  });

  it('re-deciding resets confirmed to 0', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'remove', NOW);
    db.setConfirmed(conn, `${sourceId}:1`, true);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW, '2027-01-01T00:00:00.000Z');
    expect(db.getDecision(conn, `${sourceId}:1`)).toMatchObject({ decision: 'keep', confirmed: false });
  });

  it('deleteDecision reports whether a row was removed', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    expect(db.deleteDecision(conn, `${sourceId}:1`)).toBe(false);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW);
    expect(db.deleteDecision(conn, `${sourceId}:1`)).toBe(true);
  });

  it('latestPendingDecision returns the newest non-confirmed decision', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', '2026-10-27T10:00:00.000Z');
    db.setDecision(conn, `${sourceId}:2`, 'remove', '2026-10-27T11:00:00.000Z');
    expect(db.latestPendingDecision(conn)?.itemId).toBe(`${sourceId}:2`);

    db.setConfirmed(conn, `${sourceId}:2`, true);
    expect(db.latestPendingDecision(conn)?.itemId).toBe(`${sourceId}:1`);
    db.setConfirmed(conn, `${sourceId}:1`, true);
    expect(db.latestPendingDecision(conn)).toBeNull();
  });

  it('pendingRemovals joins item and source name', () => {
    const sourceId = addSource('My TV');
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW);
    db.setDecision(conn, `${sourceId}:2`, 'remove', NOW);
    const pending = db.pendingRemovals(conn);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ itemId: `${sourceId}:2`, decision: 'remove', confirmed: false });
    expect(pending[0]?.item).toMatchObject({ id: `${sourceId}:2`, title: 'Title 2', sourceName: 'My TV' });
  });

  it('resetDecisions clears only non-confirmed rows', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show'), item('3', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW);
    db.setDecision(conn, `${sourceId}:2`, 'remove', NOW);
    db.setDecision(conn, `${sourceId}:3`, 'remove', NOW);
    db.setConfirmed(conn, `${sourceId}:3`, true);

    expect(db.resetDecisions(conn)).toBe(2);
    expect(db.getDecision(conn, `${sourceId}:1`)).toBeNull();
    expect(db.getDecision(conn, `${sourceId}:2`)).toBeNull();
    expect(db.getDecision(conn, `${sourceId}:3`)).toMatchObject({ decision: 'remove', confirmed: true });
  });
});

describe('deckBatch', () => {
  function seed(): number {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'movie')], NOW);
    return sourceId;
  }

  it('returns undecided items; totalPending counts pending removals', () => {
    const sourceId = seed();
    const { items, totalPending } = db.deckBatch(conn, 'all', 10, NOW);
    expect(totalPending).toBe(0); // no decisions yet
    expect(items.map((i) => i.id).sort()).toEqual([`${sourceId}:1`, `${sourceId}:2`].sort());
    expect(items[0]?.sourceName).toBe('TV');

    db.setDecision(conn, `${sourceId}:1`, 'remove', NOW);
    expect(db.deckBatch(conn, 'all', 10, NOW).totalPending).toBe(1);
  });

  it('excludes kept items until their reappear date passes', () => {
    const sourceId = seed();
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW, '2027-01-01T00:00:00.000Z'); // future
    db.setDecision(conn, `${sourceId}:2`, 'keep', NOW, '2026-01-01T00:00:00.000Z'); // past
    const { items, totalPending } = db.deckBatch(conn, 'all', 10, NOW);
    expect(totalPending).toBe(0); // keeps are not pending removals
    expect(items.map((i) => i.id)).toEqual([`${sourceId}:2`]);
  });

  it('excludes pending removals', () => {
    const sourceId = seed();
    db.setDecision(conn, `${sourceId}:1`, 'remove', NOW);
    const { items, totalPending } = db.deckBatch(conn, 'all', 10, NOW);
    expect(totalPending).toBe(1);
    expect(items.map((i) => i.id)).toEqual([`${sourceId}:2`]);
  });

  it('excludes items from disabled sources', () => {
    const sourceId = seed();
    db.updateSource(conn, sourceId, { enabled: false });
    const { items, totalPending } = db.deckBatch(conn, 'all', 10, NOW);
    expect(totalPending).toBe(0);
    expect(items).toHaveLength(0);
  });

  it('filters by type and honors the limit', () => {
    const sourceId = seed();
    const shows = db.deckBatch(conn, 'show', 10, NOW);
    expect(shows.items.map((i) => i.type)).toEqual(['show']);
    const movies = db.deckBatch(conn, 'movie', 10, NOW);
    expect(movies.items.map((i) => i.type)).toEqual(['movie']);

    db.upsertItems(conn, sourceId, [item('3', 'show'), item('4', 'show')], NOW);
    const limited = db.deckBatch(conn, 'all', 2, NOW);
    expect(limited.items).toHaveLength(2);
    expect(limited.totalPending).toBe(0);
  });
});

describe('browseList', () => {
  it('partitions kept / pending / removed and orders by decided_at desc', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show'), item('3', 'show'), item('4', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', '2026-10-01T00:00:00.000Z');
    db.setDecision(conn, `${sourceId}:2`, 'keep', '2026-10-03T00:00:00.000Z');
    db.setDecision(conn, `${sourceId}:3`, 'remove', '2026-10-02T00:00:00.000Z'); // pending
    db.setDecision(conn, `${sourceId}:4`, 'remove', '2026-10-04T00:00:00.000Z');
    db.setConfirmed(conn, `${sourceId}:4`, true);

    const kept = db.browseList(conn, 'kept', 50, 0);
    expect(kept.items.map((r) => r.id)).toEqual([`${sourceId}:2`, `${sourceId}:1`]);
    expect(kept.items[0]).toMatchObject({ decidedAt: '2026-10-03T00:00:00.000Z', sourceName: 'TV' });
    expect(kept.total).toBe(2);

    const pending = db.browseList(conn, 'pending', 50, 0);
    expect(pending.items.map((r) => r.id)).toEqual([`${sourceId}:3`]);
    expect(pending.total).toBe(1);

    const removed = db.browseList(conn, 'removed', 50, 0);
    expect(removed.items.map((r) => r.id)).toEqual([`${sourceId}:4`]);
    expect(removed.total).toBe(1);
  });

  it('paginates with limit and offset', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show'), item('2', 'show'), item('3', 'show')], NOW);
    for (let i = 1; i <= 3; i++) {
      db.setDecision(conn, `${sourceId}:${i}`, 'keep', `2026-10-0${i}T00:00:00.000Z`);
    }
    const page1 = db.browseList(conn, 'kept', 2, 0);
    expect(page1.items.map((r) => r.id)).toEqual([`${sourceId}:3`, `${sourceId}:2`]);
    expect(page1.total).toBe(3);
    const page2 = db.browseList(conn, 'kept', 2, 2);
    expect(page2.items.map((r) => r.id)).toEqual([`${sourceId}:1`]);
    expect(page2.total).toBe(3);
    const page3 = db.browseList(conn, 'kept', 2, 5);
    expect(page3.items).toHaveLength(0);
    expect(page3.total).toBe(3);
  });
});

describe('splitItemId', () => {
  it('parses valid composite ids', () => {
    expect(db.splitItemId('2:42')).toEqual({ sourceId: 2, externalId: '42' });
  });

  it('rejects malformed ids', () => {
    expect(db.splitItemId(':42')).toBeNull();
    expect(db.splitItemId('2:')).toBeNull();
    expect(db.splitItemId('abc')).toBeNull();
    expect(db.splitItemId('1.5:3')).toBeNull();
  });

  it('externalIdOf returns null for malformed ids', () => {
    expect(db.externalIdOf('2:42')).toBe('42');
    expect(db.externalIdOf('abc')).toBeNull();
  });
});

describe('sources', () => {
  it('deleteSource cascades to items and decisions', () => {
    const sourceId = addSource();
    db.upsertItems(conn, sourceId, [item('1', 'show')], NOW);
    db.setDecision(conn, `${sourceId}:1`, 'keep', NOW);

    db.deleteSource(conn, sourceId);
    expect(db.getSource(conn, sourceId)).toBeNull();
    expect(db.getItem(conn, `${sourceId}:1`)).toBeNull();
    expect(db.getDecision(conn, `${sourceId}:1`)).toBeNull();
  });

  it('updateSource patches fields and leaves omitted ones alone', () => {
    const sourceId = addSource();
    const updated = db.updateSource(conn, sourceId, { name: 'Renamed', enabled: false });
    expect(updated).toMatchObject({ name: 'Renamed', enabled: false, url: 'http://localhost:1' });
    expect(db.updateSource(conn, 999, { name: 'X' })).toBeNull();
  });

  it('listSources includes per-source item counts', () => {
    const a = addSource('A');
    const b = addSource('B', 'radarr');
    db.upsertItems(conn, a, [item('1', 'show'), item('2', 'show')], NOW);
    const rows = db.listSources(conn);
    expect(rows.find((s) => s.id === a)).toMatchObject({ itemCount: 2 });
    expect(rows.find((s) => s.id === b)).toMatchObject({ itemCount: 0 });
  });
});

describe('meta', () => {
  it('round-trips values and overwrites on conflict', () => {
    expect(db.getMeta(conn, 'last_sync:1')).toBeNull();
    db.setMeta(conn, 'last_sync:1', NOW);
    db.setMeta(conn, 'last_sync:1', '2026-10-28T00:00:00.000Z');
    expect(db.getMeta(conn, 'last_sync:1')).toBe('2026-10-28T00:00:00.000Z');
  });
});
