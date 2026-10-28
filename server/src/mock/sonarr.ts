import Fastify, { type FastifyInstance } from 'fastify';
import { posterSvg } from '../svg.js';
import { SONARR_SHOWS, type ShowFixture } from './fixtures.js';

export const SONARR_API_KEY = 'tossarr-mock-sonarr-key';

/** A Sonarr series as returned by GET /api/v3/series. */
interface SeriesApi {
  id: number;
  title: string;
  status: string;
  overview: string;
  network: string | null;
  genres: string[];
  year: number | null;
  runtime: number | null;
  /** Current Sonarr returns image descriptors (banner first), not plain paths. */
  images: Array<{ coverType: string; url: string }>;
  /** Current Sonarr leaves the top-level poster null; it lives in images[]. */
  poster: string | null;
}

export interface SonarrMockState {
  series: Record<number, SeriesApi>;
  deleteCalls: Array<{ id: number; query: Record<string, string> }>;
}

function toSeries(f: ShowFixture): SeriesApi {
  return {
    id: f.id,
    title: f.title,
    status: 'continuing',
    overview: f.overview,
    network: f.network,
    genres: f.genres,
    year: f.year,
    runtime: f.runtime,
    // Mirror the real API shape: no top-level poster, and objects in images[]
    // with the banner first — clients must pick 'poster' by coverType.
    images: f.posterFile
      ? [
          { coverType: 'banner', url: `/posters/${f.posterFile}` },
          { coverType: 'poster', url: `/posters/${f.posterFile}` },
        ]
      : [],
    poster: null,
  };
}

/** Fastify instance that emulates the Sonarr v3 API over in-memory state. */
export function buildSonarrMock(): { app: FastifyInstance; state: SonarrMockState } {
  const state: SonarrMockState = {
    series: Object.fromEntries(SONARR_SHOWS.map((s) => [s.id, toSeries(s)])),
    deleteCalls: [],
  };

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/__mock/')) return;
    if (req.headers['x-api-key'] !== SONARR_API_KEY) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/v3/series', async () => Object.values(state.series));

  app.delete<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/v3/series/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || state.series[id] === undefined) {
        return reply.code(404).send({ error: 'Not found' });
      }
      delete state.series[id];
      state.deleteCalls.push({ id, query: req.query ?? {} });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { file: string } }>('/posters/:file', async (req, reply) => {
    const fixture = SONARR_SHOWS.find((s) => s.posterFile === req.params.file);
    if (!fixture) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type('image/svg+xml')
      .send(posterSvg(fixture.title, `Sonarr mock · ${fixture.year ?? ''}`));
  });

  // API-key-authenticated cover endpoint; real Sonarr v4+ gates /MediaCover behind a session.
  app.get<{ Params: { id: string; file: string } }>('/api/v3/mediacover/:id/:file', async (req, reply) => {
    const fixture = SONARR_SHOWS.find((s) => s.id === Number(req.params.id));
    if (!fixture?.posterFile) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type('image/svg+xml')
      .send(posterSvg(fixture.title, `Sonarr mock · ${fixture.year ?? ''}`));
  });

  app.get('/__mock/state', async () => ({ series: state.series, deleteCalls: state.deleteCalls }));

  return { app, state };
}
