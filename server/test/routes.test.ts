import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../src/db.js';
import { buildRadarrMock, RADARR_API_KEY, type RadarrMockState } from '../src/mock/radarr.js';
import { buildSonarrMock, SONARR_API_KEY, type SonarrMockState } from '../src/mock/sonarr.js';
import { syncOne } from '../src/sync.js';
import { createTestApp, disposeDb, listenRandom, type TestApp } from './helpers.js';

const DELETE_PARAMS = { removeFromDb: 'true', deleteFiles: 'true', addImportExclusion: 'false' };
const INDEX_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');

interface Fixture extends TestApp {
  sonarrUrl: string;
  radarrUrl: string;
  sonarrState: SonarrMockState;
  radarrState: RadarrMockState;
  closeAll: () => Promise<void>;
}

let f: Fixture;

beforeEach(async () => {
  const t = await createTestApp();
  const s = buildSonarrMock();
  const r = buildRadarrMock();
  const [su, ru] = await Promise.all([listenRandom(s.app), listenRandom(r.app)]);
  f = {
    ...t,
    sonarrUrl: su.url,
    radarrUrl: ru.url,
    sonarrState: s.state,
    radarrState: r.state,
    closeAll: async () => {
      await t.close();
      await Promise.all([su.close(), ru.close()]);
      disposeDb(t.db, t.dir);
    },
  };
});

afterEach(async () => {
  await f.closeAll();
});

async function addSource(name: string, kind: 'sonarr' | 'radarr', url: string, apiKey: string): Promise<number> {
  const res = await f.app.inject({ method: 'POST', url: '/api/sources', payload: { name, kind, url, apiKey } });
  expect(res.statusCode).toBe(201);
  return res.json().id as number;
}

/** Create both mock-backed sources and sync them so the deck has all 16 items. */
async function seedBoth(): Promise<{ sonarrId: number; radarrId: number }> {
  const sonarrId = await addSource('TV', 'sonarr', f.sonarrUrl, SONARR_API_KEY);
  const radarrId = await addSource('Movies', 'radarr', f.radarrUrl, RADARR_API_KEY);
  await syncOne(f.db, sonarrId);
  await syncOne(f.db, radarrId);
  return { sonarrId, radarrId };
}

async function deckIds(): Promise<string[]> {
  const res = await f.app.inject({ method: 'GET', url: '/api/library?limit=50' });
  expect(res.statusCode).toBe(200);
  return (res.json().items as Array<{ id: string }>).map((i) => i.id).sort();
}

async function browse(list: string): Promise<Array<Record<string, unknown>>> {
  const res = await f.app.inject({ method: 'GET', url: `/api/browse?list=${list}` });
  expect(res.statusCode).toBe(200);
  return res.json().items as Array<Record<string, unknown>>;
}

describe('health and 404s', () => {
  it('GET /api/health returns ok', async () => {
    const res = await f.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('unknown /api/* paths get a JSON 404', async () => {
    const res = await f.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('non-API unknown paths fall back to the SPA shell (or a 503 when unbuilt)', async () => {
    const res = await f.app.inject({ method: 'GET', url: '/some/spa/route' });
    if (existsSync(INDEX_HTML)) {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    } else {
      expect(res.statusCode).toBe(503);
    }
  });
});

describe('sources', () => {
  it('rejects invalid create payloads', async () => {
    const base = { name: 'TV', kind: 'sonarr', url: f.sonarrUrl, apiKey: SONARR_API_KEY };
    for (const payload of [{}, { ...base, name: '' }, { ...base, kind: 'plex' }, { ...base, url: 'ftp://nope' }, { ...base, apiKey: '' }]) {
      const res = await f.app.inject({ method: 'POST', url: '/api/sources', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('creates a source with a masked key and triggers a sync', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: 'TV', kind: 'sonarr', url: f.sonarrUrl, apiKey: SONARR_API_KEY },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: 1,
      name: 'TV',
      kind: 'sonarr',
      enabled: true,
      apiKey: 'toss…',
      itemCount: 0,
      lastSync: null,
    });
    expect(f.triggerSyncs).toEqual([1]);
  });

  it('lists sources with item counts and last sync after syncing', async () => {
    const { sonarrId, radarrId } = await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const tv = rows.find((r) => r.id === sonarrId);
    const movies = rows.find((r) => r.id === radarrId);
    expect(tv).toMatchObject({ name: 'TV', itemCount: 8, apiKey: 'toss…' });
    expect(typeof tv?.lastSync).toBe('string');
    expect(movies).toMatchObject({ name: 'Movies', itemCount: 8 });
  });

  it('PUT with a masked key leaves the stored key unchanged; a real key replaces it', async () => {
    const id = await addSource('TV', 'sonarr', f.sonarrUrl, SONARR_API_KEY);
    const masked = (await f.app.inject({ method: 'GET', url: '/api/sources' })).json().find((s: { id: number }) => s.id === id).apiKey as string;

    let res = await f.app.inject({ method: 'PUT', url: `/api/sources/${id}`, payload: { apiKey: masked } });
    expect(res.statusCode).toBe(200);
    expect(db.getSource(f.db, id)?.apiKey).toBe(SONARR_API_KEY);

    res = await f.app.inject({ method: 'PUT', url: `/api/sources/${id}`, payload: { apiKey: 'brand-new-key-123' } });
    expect(res.statusCode).toBe(200);
    expect(db.getSource(f.db, id)?.apiKey).toBe('brand-new-key-123');
    expect((res.json() as { apiKey: string }).apiKey).toBe('bran…');
  });

  it('PUT validates fields and 404s on unknown ids', async () => {
    const id = await addSource('TV', 'sonarr', f.sonarrUrl, SONARR_API_KEY);
    expect((await f.app.inject({ method: 'PUT', url: `/api/sources/${id}`, payload: { name: '' } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PUT', url: `/api/sources/${id}`, payload: { url: 'nope' } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PUT', url: `/api/sources/${id}`, payload: { enabled: 'yes' } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PUT', url: '/api/sources/99', payload: { name: 'X' } })).statusCode).toBe(404);
  });

  it('DELETE removes the source and cascades its items', async () => {
    const { sonarrId } = await seedBoth();
    expect((await f.app.inject({ method: 'DELETE', url: `/api/sources/${sonarrId}` })).statusCode).toBe(204);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/sources/${sonarrId}` })).statusCode).toBe(404);

    const deck = await deckIds();
    expect(deck.some((id) => id.startsWith(`${sonarrId}:`))).toBe(false);
    expect(deck).toHaveLength(8); // only the radarr source remains
  });

  it('POST /api/sources/test reports item count, auth failure, and unreachable sources', async () => {
    const ok = await f.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { kind: 'sonarr', url: f.sonarrUrl, apiKey: SONARR_API_KEY },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, itemCount: 8 });

    const radarr = await f.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { kind: 'radarr', url: f.radarrUrl, apiKey: RADARR_API_KEY },
    });
    expect(radarr.json()).toEqual({ ok: true, itemCount: 8 }); // hasFile=false movies excluded

    const badKey = await f.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { kind: 'sonarr', url: f.sonarrUrl, apiKey: 'wrong' },
    });
    expect(badKey.statusCode).toBe(502);
    expect(badKey.json().ok).toBe(false);

    const dead = await f.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { kind: 'sonarr', url: 'http://127.0.0.1:9', apiKey: 'k' },
    });
    expect(dead.statusCode).toBe(502);

    expect((await f.app.inject({ method: 'POST', url: '/api/sources/test', payload: { kind: 'x', url: f.sonarrUrl, apiKey: 'k' } })).statusCode).toBe(400);
  });
});

describe('library (deck)', () => {
  it('aggregates enabled sources and reports the pending-removal count', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/library' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>>; totalPending: number };
    expect(body.totalPending).toBe(0); // no decisions yet
    expect(body.items).toHaveLength(16);

    const office = body.items.find((i) => i.id === '1:101');
    expect(office).toMatchObject({
      sourceId: 1,
      sourceName: 'TV',
      type: 'show',
      title: 'The Office',
      posterUrl: '/api/posters/1/101',
    });
    expect(office?.meta).toMatchObject({ network: 'NBC' });

    // totalPending tracks pending removals, not the deck size.
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:102', payload: { decision: 'remove' } })).statusCode).toBe(200);
    const after = (await f.app.inject({ method: 'GET', url: '/api/library' })).json() as { totalPending: number };
    expect(after.totalPending).toBe(1);
  });

  it('filters by type', async () => {
    await seedBoth();
    const shows = (await f.app.inject({ method: 'GET', url: '/api/library?filter=show' })).json() as { items: Array<{ type: string }>; totalPending: number };
    expect(shows.totalPending).toBe(0);
    expect(new Set(shows.items.map((i) => i.type))).toEqual(new Set(['show']));

    const movies = (await f.app.inject({ method: 'GET', url: '/api/library?filter=movie' })).json() as { items: Array<{ type: string }>; totalPending: number };
    expect(movies.totalPending).toBe(0);
    expect(new Set(movies.items.map((i) => i.type))).toEqual(new Set(['movie']));

    // Unknown filters fall back to 'all'.
    const all = (await f.app.inject({ method: 'GET', url: '/api/library?filter=bogus' })).json() as { totalPending: number };
    expect(all.totalPending).toBe(0);
  });
});

describe('decisions', () => {
  it('rejects unknown items and invalid decision values', async () => {
    await seedBoth();
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/9:9', payload: { decision: 'keep' } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:101', payload: { decision: 'maybe' } })).statusCode).toBe(400);
  });

  it('keep schedules a reappear date and hides the item from the deck', async () => {
    await seedBoth();
    const before = Date.now();
    const res = await f.app.inject({ method: 'POST', url: '/api/decisions/1:101', payload: { decision: 'keep' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { itemId: string; decision: string; nextDue: string };
    expect(body.itemId).toBe('1:101');
    expect(body.decision).toBe('keep');
    expect(Math.abs(Date.parse(body.nextDue) - (before + 30 * 86_400_000))).toBeLessThan(10_000);

    const deck = await deckIds();
    expect(deck).not.toContain('1:101');
    expect((await browse('kept')).map((i) => i.id)).toContain('1:101');
  });

  it('remove parks the item in pending; undo returns it to the deck', async () => {
    await seedBoth();
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:102', payload: { decision: 'remove' } })).statusCode).toBe(200);

    const pending = await browse('pending');
    expect(pending.map((i) => i.id)).toEqual(['1:102']);
    expect(await deckIds()).not.toContain('1:102');

    const undo = await f.app.inject({ method: 'POST', url: '/api/decisions/undo' });
    expect(undo.statusCode).toBe(200);
    expect((undo.json() as { item: { id: string } }).item.id).toBe('1:102');

    expect(await deckIds()).toContain('1:102');
    expect((await browse('pending')).map((i) => i.id)).toEqual([]);
  });

  it('undo with nothing pending is a 404', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'POST', url: '/api/decisions/undo' });
    expect(res.statusCode).toBe(404);
  });

  it('confirm deletes upstream with the agreed params and tombstones locally', async () => {
    await seedBoth();
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:103', payload: { decision: 'remove' } });

    const res = await f.app.inject({ method: 'POST', url: '/api/decisions/1:103/confirm' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(f.sonarrState.deleteCalls).toEqual([{ id: 103, query: DELETE_PARAMS }]);
    expect(f.sonarrState.series[103]).toBeUndefined();

    // Re-confirm is a conflict; the item stays in Removed and survives re-syncs.
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:103/confirm' })).statusCode).toBe(409);
    expect((await browse('removed')).map((i) => i.id)).toEqual(['1:103']);

    await syncOne(f.db, 1);
    expect(db.getItem(f.db, '1:103')).not.toBeNull();
    expect(await deckIds()).not.toContain('1:103');
  });

  it('confirm refuses items that are not pending removals', async () => {
    await seedBoth();
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:101', payload: { decision: 'keep' } });
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:101/confirm' })).statusCode).toBe(409);
    expect((await f.app.inject({ method: 'POST', url: '/api/decisions/1:102/confirm' })).statusCode).toBe(409);
  });

  it('confirm failure keeps the removal pending (502)', async () => {
    await seedBoth();
    const deadId = await addSource('Dead', 'sonarr', 'http://127.0.0.1:9', 'key');
    db.upsertItems(f.db, deadId, [{ externalId: '1', type: 'show', title: 'Ghost', year: null, posterPath: null, overview: '', meta: {} }], new Date().toISOString());
    db.setDecision(f.db, `${deadId}:1`, 'remove', new Date().toISOString());

    const res = await f.app.inject({ method: 'POST', url: `/api/decisions/${deadId}:1/confirm` });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: string }).error).toMatch(/Cannot reach source/);

    expect((await browse('pending')).map((i) => i.id)).toContain(`${deadId}:1`);
  });

  it('confirm-all confirms what it can and reports per-item failures', async () => {
    await seedBoth();
    const deadId = await addSource('Dead', 'sonarr', 'http://127.0.0.1:9', 'key');
    db.upsertItems(f.db, deadId, [{ externalId: '1', type: 'show', title: 'Ghost', year: null, posterPath: null, overview: '', meta: {} }], new Date().toISOString());

    await f.app.inject({ method: 'POST', url: '/api/decisions/1:104', payload: { decision: 'remove' } });
    await f.app.inject({ method: 'POST', url: '/api/decisions/2:201', payload: { decision: 'remove' } });
    db.setDecision(f.db, `${deadId}:1`, 'remove', new Date().toISOString());

    const res = await f.app.inject({ method: 'POST', url: '/api/decisions/confirm-all' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { confirmed: number; failed: Array<{ itemId: string; error: string }> };
    expect(body.confirmed).toBe(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.itemId).toBe(`${deadId}:1`);
    expect(body.failed[0]?.error).toMatch(/Cannot reach source/);

    expect(f.sonarrState.deleteCalls.map((c) => c.id)).toContain(104);
    expect(f.radarrState.deleteCalls.map((c) => c.id)).toContain(201);
    for (const call of f.sonarrState.deleteCalls) expect(call.query).toEqual(DELETE_PARAMS);
    for (const call of f.radarrState.deleteCalls) expect(call.query).toEqual(DELETE_PARAMS);
  });

  it('reset clears keeps and pending removals but preserves confirmed ones', async () => {
    await seedBoth();
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:101', payload: { decision: 'keep' } });
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:102', payload: { decision: 'remove' } });
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:103', payload: { decision: 'remove' } });
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:103/confirm' });

    const res = await f.app.inject({ method: 'POST', url: '/api/decisions/reset' });
    expect(res.json()).toEqual({ ok: true, cleared: 2 });

    expect((await browse('kept')).map((i) => i.id)).toEqual([]);
    expect((await browse('pending')).map((i) => i.id)).toEqual([]);
    expect((await browse('removed')).map((i) => i.id)).toEqual(['1:103']);

    const deck = await deckIds();
    expect(deck).toContain('1:101');
    expect(deck).toContain('1:102');
    expect(deck).not.toContain('1:103');
  });

  it('DELETE clears a single decision; second delete is a 404', async () => {
    await seedBoth();
    await f.app.inject({ method: 'POST', url: '/api/decisions/1:101', payload: { decision: 'keep' } });

    expect((await f.app.inject({ method: 'DELETE', url: '/api/decisions/1:101' })).statusCode).toBe(204);
    expect(await deckIds()).toContain('1:101');
    expect((await f.app.inject({ method: 'DELETE', url: '/api/decisions/1:101' })).statusCode).toBe(404);
  });
});

describe('browse', () => {
  it('rejects unknown lists', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/browse?list=bogus' });
    expect(res.statusCode).toBe(400);
  });

  it('paginates with limit/offset and includes decidedAt', async () => {
    await seedBoth();
    const now = Date.now();
    for (const [n, id] of [['1:101', 1], ['1:102', 2], ['1:104', 3]] as Array<[string, number]>) {
      db.setDecision(f.db, n, 'keep', new Date(now + id * 1000).toISOString());
    }

    const page1 = (await f.app.inject({ method: 'GET', url: '/api/browse?list=kept&limit=2' })).json() as { items: Array<{ id: string; decidedAt: string }>; total: number };
    expect(page1.items.map((i) => i.id)).toEqual(['1:104', '1:102']); // newest first
    expect(page1.items[0]?.decidedAt).toBeTruthy();
    expect(page1.total).toBe(3);

    const page2 = (await f.app.inject({ method: 'GET', url: '/api/browse?list=kept&limit=2&offset=2' })).json() as { items: Array<{ id: string }>; total: number };
    expect(page2.items.map((i) => i.id)).toEqual(['1:101']);
    expect(page2.total).toBe(3);

    const clamped = (await f.app.inject({ method: 'GET', url: '/api/browse?list=kept&limit=9999' })).json() as { items: unknown[]; total: number };
    expect(clamped.items.length).toBeLessThanOrEqual(200);
    expect(clamped.total).toBe(3);
  });
});

describe('settings', () => {
  it('GET returns the current settings', async () => {
    const res = await f.app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.json()).toEqual({ syncIntervalHours: 6, keepReappearDays: 30 });
  });

  it('PUT patches individual fields and persists to settings.json', async () => {
    const res = await f.app.inject({ method: 'PUT', url: '/api/settings', payload: { keepReappearDays: 45 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ syncIntervalHours: 6, keepReappearDays: 45 });

    const onDisk = JSON.parse(readFileSync(path.join(f.dir, 'settings.json'), 'utf8')) as Record<string, number>;
    expect(onDisk).toEqual({ syncIntervalHours: 6, keepReappearDays: 45 });

    expect((await f.app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ syncIntervalHours: 6, keepReappearDays: 45 });
  });

  it('PUT rejects non-positive numbers', async () => {
    expect((await f.app.inject({ method: 'PUT', url: '/api/settings', payload: { syncIntervalHours: -1 } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PUT', url: '/api/settings', payload: { keepReappearDays: 0 } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ syncIntervalHours: 6, keepReappearDays: 30 });
  });
});

describe('posters', () => {
  it('proxies upstream posters with caching headers', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/posters/1/101' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml'); // mock serves SVGs
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.payload).toContain('<svg');
  });

  it('falls back to a generated SVG when the item has no poster', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/posters/1/103' }); // Fringe: posterFile null
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.payload).toContain('<svg');
  });

  it('falls back to a generated SVG for unknown items', async () => {
    await seedBoth();
    const res = await f.app.inject({ method: 'GET', url: '/api/posters/9/999' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });
});

describe('manual sync', () => {
  it('POST /api/sync enqueues a full sync through the trigger', async () => {
    await seedBoth();
    f.triggerSyncs.length = 0;
    const res = await f.app.inject({ method: 'POST', url: '/api/sync' });
    expect(res.json()).toEqual({ ok: true });
    expect(f.triggerSyncs).toEqual([undefined]);
  });
});
