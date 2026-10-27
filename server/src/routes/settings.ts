import type { FastifyInstance } from 'fastify';
import { saveSettings } from '../config.js';
import type { AppContext } from '../context.js';
import type { Settings } from '../types.js';

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/settings', async () => ctx.config.settings);

  app.put<{ Body: Partial<Settings> }>('/api/settings', async (req, reply) => {
    const body = req.body ?? {};
    const current = ctx.config.settings;
    const next: Settings = { ...current };

    if (body.syncIntervalHours !== undefined) {
      if (typeof body.syncIntervalHours !== 'number' || !Number.isFinite(body.syncIntervalHours) || body.syncIntervalHours <= 0) {
        return reply.code(400).send({ error: 'syncIntervalHours must be a number > 0' });
      }
      next.syncIntervalHours = body.syncIntervalHours;
    }
    if (body.keepReappearDays !== undefined) {
      if (typeof body.keepReappearDays !== 'number' || !Number.isFinite(body.keepReappearDays) || body.keepReappearDays <= 0) {
        return reply.code(400).send({ error: 'keepReappearDays must be a number > 0' });
      }
      next.keepReappearDays = body.keepReappearDays;
    }

    saveSettings(ctx.config, next);
    return next;
  });
}
