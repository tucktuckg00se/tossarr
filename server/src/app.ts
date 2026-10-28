import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppContext } from './context.js';
import { browseRoutes } from './routes/browse.js';
import { decisionsRoutes } from './routes/decisions.js';
import { libraryRoutes } from './routes/library.js';
import { posterRoutes } from './routes/posters.js';
import { settingsRoutes } from './routes/settings.js';
import { sourcesRoutes } from './routes/sources.js';
import { syncRoutes } from './routes/sync.js';

/** Built web app (server/public), resolved by walking up to the package root. */
function publicDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'server', 'public');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Should be unreachable; keep a sensible default relative to this file.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
}

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(settingsRoutes, ctx);
  await app.register(sourcesRoutes, ctx);
  await app.register(libraryRoutes, ctx);
  await app.register(decisionsRoutes, ctx);
  await app.register(syncRoutes, ctx);
  await app.register(browseRoutes, ctx);
  await app.register(posterRoutes, ctx);

  app.get('/api/health', async () => ({ ok: true }));

  const pub = publicDir();
  if (existsSync(pub)) {
    // Serves built assets; files that don't exist fall through to the handler below.
    await app.register(fastifyStatic, { root: pub });
  }

  // Unknown /api/* paths get a JSON 404; anything else serves index.html (SPA fallback).
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not found' });
    }
    const index = path.join(pub, 'index.html');
    if (!existsSync(index)) {
      return reply
        .code(503)
        .send({ error: 'web app not built — run `npm run build`, or use the Vite dev server on :5173' });
    }
    return reply.code(200).type('text/html').send(createReadStream(index));
  });

  return app;
}
