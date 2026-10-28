import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import * as db from '../db.js';
import { toItem } from '../items.js';
import { clampInt } from '../util.js';

export async function browseRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Querystring: { list?: string; limit?: string; offset?: string } }>('/api/browse', async (req, reply) => {
    const raw = req.query.list ?? 'kept';
    if (raw !== 'kept' && raw !== 'pending' && raw !== 'removed') {
      return reply.code(400).send({ error: "list must be 'kept', 'pending' or 'removed'" });
    }
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

    const { items, total } = db.browseList(ctx.db, raw, limit, offset);
    return { list: raw, items: items.map((r) => ({ ...toItem(r), decidedAt: r.decidedAt })), total };
  });
}
