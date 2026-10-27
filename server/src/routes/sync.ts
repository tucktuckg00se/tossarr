import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function syncRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Manual resync of all enabled sources. Runs in the background through the
  // same queue as the scheduler; poll /api/sources for lastSync/itemCount.
  app.post('/api/sync', async () => {
    ctx.triggerSync();
    return { ok: true };
  });
}
