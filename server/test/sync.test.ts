import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../src/db.js';
import { buildSonarrMock, SONARR_API_KEY } from '../src/mock/sonarr.js';
import { syncAll, syncOne, syncSource } from '../src/sync.js';
import { disposeDb, freshDb, listenRandom } from './helpers.js';

interface Fixture {
  db: Database;
  dir: string;
  sonarrUrl: string;
  sonarrState: ReturnType<typeof buildSonarrMock>['state'];
  close: () => Promise<void>;
}

let f: Fixture;

beforeEach(async () => {
  const { db, dir } = freshDb();
  const mock = buildSonarrMock();
  const listen = await listenRandom(mock.app);
  f = { db, dir, sonarrUrl: listen.url, sonarrState: mock.state, close: async () => { await listen.close(); disposeDb(db, dir); } };
});

afterEach(async () => {
  await f.close();
});

function addSource(kind: 'sonarr' | 'radarr', url: string): number {
  return db.createSource(f.db, { name: `src-${kind}`, kind, url, apiKey: SONARR_API_KEY }).id;
}

describe('syncOne / syncSource', () => {
  it('upserts all items and stamps last_sync', async () => {
    const sourceId = addSource('sonarr', f.sonarrUrl);
    const res = await syncOne(f.db, sourceId);
    expect(res).toEqual({ sourceId, added: 8, updated: 0, pruned: 0 });
    expect(db.getItem(f.db, `${sourceId}:101`)).not.toBeNull();
    expect(new Date(db.getMeta(f.db, `last_sync:${sourceId}`) ?? '').getTime()).not.toBeNaN();
  });

  it('updates survivors and prunes items that vanished upstream', async () => {
    const sourceId = addSource('sonarr', f.sonarrUrl);
    await syncOne(f.db, sourceId);
    delete f.sonarrState.series[108];

    const res = await syncOne(f.db, sourceId);
    expect(res).toEqual({ sourceId, added: 0, updated: 7, pruned: 1 });
    expect(db.getItem(f.db, `${sourceId}:108`)).toBeNull();
  });

  it('keeps tombstoned items across syncs', async () => {
    const sourceId = addSource('sonarr', f.sonarrUrl);
    await syncOne(f.db, sourceId);
    db.setDecision(f.db, `${sourceId}:105`, 'remove', new Date().toISOString());
    db.setConfirmed(f.db, `${sourceId}:105`, true);
    delete f.sonarrState.series[105];

    const res = await syncOne(f.db, sourceId);
    expect(res.pruned).toBe(0);
    expect(db.getItem(f.db, `${sourceId}:105`)).not.toBeNull();
  });

  it('throws for an unknown source', async () => {
    await expect(syncOne(f.db, 99)).rejects.toThrow('Source 99 not found');
  });

  it('syncSource works with a source row directly', async () => {
    const sourceId = addSource('sonarr', f.sonarrUrl);
    const res = await syncSource(f.db, db.getSource(f.db, sourceId)!);
    expect(res.added).toBe(8);
  });
});

describe('syncAll', () => {
  it('skips disabled sources and captures per-source errors', async () => {
    const okId = addSource('sonarr', f.sonarrUrl);
    const deadId = addSource('sonarr', 'http://127.0.0.1:9');
    const disabledId = db.createSource(f.db, { name: 'disabled', kind: 'radarr', url: f.sonarrUrl, apiKey: SONARR_API_KEY }).id;
    db.updateSource(f.db, disabledId, { enabled: false });

    const results = await syncAll(f.db);

    expect(results).toHaveLength(2); // disabled source is skipped entirely
    expect(results[0]).toMatchObject({ sourceId: okId, added: 8 });
    expect(results[0]?.error).toBeUndefined();
    expect(results[1]).toMatchObject({ sourceId: deadId, added: 0, updated: 0, pruned: 0 });
    expect(results[1]?.error).toMatch(/Cannot reach source/);
  });
});
