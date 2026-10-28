import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SourceError } from '../src/clients/index.js';
import { buildRadarrMock, RADARR_API_KEY } from '../src/mock/radarr.js';
import { buildSonarrMock, SONARR_API_KEY } from '../src/mock/sonarr.js';
import { listenRandom } from './helpers.js';

let sonarrUrl: string;
let radarrUrl: string;
let closes: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const s = buildSonarrMock();
  const r = buildRadarrMock();
  const [su, ru] = await Promise.all([listenRandom(s.app), listenRandom(r.app)]);
  sonarrUrl = su.url;
  radarrUrl = ru.url;
  closes = [su.close, ru.close];
});

afterAll(async () => {
  await Promise.all(closes.map((c) => c()));
});

describe('sonarr client', () => {
  // Created per test: the mocks only exist after beforeAll has run.
  const client = () => createClient({ kind: 'sonarr', url: sonarrUrl, apiKey: SONARR_API_KEY });

  it('lists all series normalized', async () => {
    const items = await client().listItems();
    expect(items).toHaveLength(8);
    for (const i of items) expect(i.type).toBe('show');
    expect(items.map((i) => i.externalId).sort()).toEqual(['101', '102', '103', '104', '105', '106', '107', '108']);

    const office = items.find((i) => i.externalId === '101');
    expect(office).toMatchObject({ title: 'The Office', year: 2005, posterPath: '/posters/show-101.svg' });
    expect(office?.meta).toMatchObject({ network: 'NBC', runtime: 22, genres: ['Comedy'] });

    // Posterless series normalize to null.
    expect(items.find((i) => i.externalId === '103')?.posterPath).toBeNull();
  });

  it('deletes upstream with the agreed query params; second delete reports alreadyGone', async () => {
    const gone = await client().deleteItem('107');
    expect(gone).toBe(false);
    const again = await client().deleteItem('107');
    expect(again).toBe(true);
  });

  it('rejects with a SourceError on bad auth', async () => {
    const bad = createClient({ kind: 'sonarr', url: sonarrUrl, apiKey: 'wrong-key' });
    await expect(bad.listItems()).rejects.toMatchObject({ name: 'SourceError', status: 401 });
  });

  it('rejects with a SourceError when unreachable', async () => {
    const dead = createClient({ kind: 'sonarr', url: 'http://127.0.0.1:9', apiKey: 'k' });
    await expect(dead.listItems()).rejects.toThrow(/Cannot reach source/);
  });
});

describe('radarr client', () => {
  const client = () => createClient({ kind: 'radarr', url: radarrUrl, apiKey: RADARR_API_KEY });

  it('lists only movies that have files', async () => {
    const items = await client().listItems();
    // Fixtures 209 and 210 have hasFile=false and must be filtered out.
    expect(items).toHaveLength(8);
    for (const i of items) expect(i.type).toBe('movie');
    expect(items.map((i) => i.externalId)).not.toContain('209');
    expect(items.map((i) => i.externalId)).not.toContain('210');

    const dk = items.find((i) => i.externalId === '201');
    expect(dk).toMatchObject({ title: 'The Dark Knight', posterPath: '/posters/movie-201.svg' });
    expect(dk?.meta).toMatchObject({ imdbId: 1853728 });

    // Posterless movie normalizes to null.
    expect(items.find((i) => i.externalId === '203')?.posterPath).toBeNull();
  });

  it('deletes upstream with the agreed query params', async () => {
    const gone = await client().deleteItem('210'); // hasFile=false, still present in mock state
    expect(gone).toBe(false);
    expect(await client().deleteItem('210')).toBe(true);
  });

  it('rejects with a SourceError on bad auth', async () => {
    const bad = createClient({ kind: 'radarr', url: radarrUrl, apiKey: 'wrong-key' });
    await expect(bad.listItems()).rejects.toThrow(SourceError);
  });
});
