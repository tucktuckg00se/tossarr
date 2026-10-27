import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import * as db from '../db.js';
import { toItem } from '../items.js';
import type { ItemType } from '../types.js';
import { clampInt } from '../util.js';

export async function libraryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Querystring: { filter?: string; limit?: string } }>('/api/library', async (req) => {
    const filter: 'all' | ItemType =
      req.query.filter === 'show' || req.query.filter === 'movie' ? req.query.filter : 'all';
    const limit = clampInt(req.query.limit, 20, 1, 50);
    const { items, totalPending } = db.deckBatch(ctx.db, filter, limit, new Date().toISOString());
    return { items: items.map(toItem), totalPending };
  });
}
