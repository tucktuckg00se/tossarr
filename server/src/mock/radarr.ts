import Fastify, { type FastifyInstance } from 'fastify';
import { posterSvg } from '../svg.js';
import { RADARR_MOVIES, type MovieFixture } from './fixtures.js';

export const RADARR_API_KEY = 'tossarr-mock-radarr-key';

/** A Radarr movie as returned by GET /api/v3/movie. */
interface MovieApi {
  id: number;
  title: string;
  overview: string;
  year: number | null;
  images: Array<{ coverType: string; url: string }>;
  poster: string | null;
  hasFile: boolean;
  imdbId: number | null;
  runtime: number | null;
  genres: string[];
}

export interface RadarrMockState {
  movies: Record<number, MovieApi>;
  deleteCalls: Array<{ id: number; query: Record<string, string> }>;
}

function toMovie(f: MovieFixture): MovieApi {
  return {
    id: f.id,
    title: f.title,
    overview: f.overview,
    year: f.year,
    images: f.posterFile ? [{ coverType: 'poster', url: `/posters/${f.posterFile}` }] : [],
    poster: f.posterFile ? `/posters/${f.posterFile}` : null,
    hasFile: f.hasFile,
    imdbId: f.imdbId,
    runtime: f.runtime,
    genres: f.genres,
  };
}

/** Fastify instance that emulates the Radarr v3 API over in-memory state. */
export function buildRadarrMock(): { app: FastifyInstance; state: RadarrMockState } {
  const state: RadarrMockState = {
    movies: Object.fromEntries(RADARR_MOVIES.map((m) => [m.id, toMovie(m)])),
    deleteCalls: [],
  };

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/__mock/')) return;
    if (req.headers['x-api-key'] !== RADARR_API_KEY) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get<{ Querystring: { hasFile?: string } }>('/api/v3/movie', async (req) => {
    let movies = Object.values(state.movies);
    if (req.query.hasFile === 'true') movies = movies.filter((m) => m.hasFile);
    return movies;
  });

  app.delete<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/v3/movie/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || state.movies[id] === undefined) {
        return reply.code(404).send({ error: 'Not found' });
      }
      delete state.movies[id];
      state.deleteCalls.push({ id, query: req.query ?? {} });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { file: string } }>('/posters/:file', async (req, reply) => {
    const fixture = RADARR_MOVIES.find((m) => m.posterFile === req.params.file);
    if (!fixture) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type('image/svg+xml')
      .send(posterSvg(fixture.title, `Radarr mock · ${fixture.year ?? ''}`));
  });

  // API-key-authenticated cover endpoint; real Radarr v5+ gates /MediaCover behind a session.
  app.get<{ Params: { id: string; file: string } }>('/api/v3/mediacover/:id/:file', async (req, reply) => {
    const fixture = RADARR_MOVIES.find((m) => m.id === Number(req.params.id));
    if (!fixture?.posterFile) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type('image/svg+xml')
      .send(posterSvg(fixture.title, `Radarr mock · ${fixture.year ?? ''}`));
  });

  app.get('/__mock/state', async () => ({ movies: state.movies, deleteCalls: state.deleteCalls }));

  return { app, state };
}
