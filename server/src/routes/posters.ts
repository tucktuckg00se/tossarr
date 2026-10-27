import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import * as db from '../db.js';
import { posterSvg } from '../svg.js';

export async function posterRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Proxy the source's poster; fall back to a generated SVG on any failure.
  app.get<{ Params: { sourceId: string; extId: string } }>('/api/posters/:sourceId/:extId', async (req, reply) => {
    const sourceId = Number(req.params.sourceId);
    const item = db.getItem(ctx.db, `${req.params.sourceId}:${req.params.extId}`);
    const source = Number.isInteger(sourceId) ? db.getSource(ctx.db, sourceId) : null;

    if (source && item?.posterPath) {
      try {
        const base = source.url.replace(/\/+$/, '');
        const posterUrl = item.posterPath.startsWith('http') ? item.posterPath : base + item.posterPath;
        const res = await fetch(posterUrl, {
          headers: { 'X-Api-Key': source.apiKey },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') ?? 'image/jpeg';
          const buf = Buffer.from(await res.arrayBuffer());
          return reply.type(contentType).header('cache-control', 'private, max-age=3600').send(buf);
        }
      } catch {
        // Unreachable source or bad poster — fall through to the generated one.
      }
    }

    return reply.type('image/svg+xml').send(posterSvg(item?.title ?? 'Unknown'));
  });
}
