import type { FastifyInstance } from 'fastify';
import { createClient } from '../clients/index.js';
import type { AppContext } from '../context.js';
import * as db from '../db.js';
import { errorMessage, isMaskedKey, maskApiKey } from '../util.js';

type SourceView = db.SourceRow & { itemCount?: number };

function publicSource(row: SourceView, lastSync: string | null) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    apiKey: maskApiKey(row.apiKey),
    enabled: row.enabled,
    itemCount: row.itemCount ?? 0,
    lastSync,
  };
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function sourcesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/sources', async () =>
    db.listSources(ctx.db).map((s) => publicSource(s, db.getMeta(ctx.db, `last_sync:${s.id}`))),
  );

  app.post<{ Body: { name?: unknown; kind?: unknown; url?: unknown; apiKey?: unknown } }>(
    '/api/sources',
    async (req, reply) => {
      const { name, kind, url, apiKey } = req.body ?? {};
      if (typeof name !== 'string' || name.trim() === '') return reply.code(400).send({ error: 'name is required' });
      if (kind !== 'sonarr' && kind !== 'radarr') {
        return reply.code(400).send({ error: "kind must be 'sonarr' or 'radarr'" });
      }
      if (!isValidUrl(url)) return reply.code(400).send({ error: 'url must be an http(s) URL' });
      if (typeof apiKey !== 'string' || apiKey.trim() === '') return reply.code(400).send({ error: 'apiKey is required' });

      const source = db.createSource(ctx.db, { name: name.trim(), kind, url, apiKey });
      ctx.triggerSync(source.id); // fire-and-forget; results surface via lastSync
      return reply.code(201).send(publicSource(source, null));
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: unknown; url?: unknown; apiKey?: unknown; enabled?: unknown } }>(
    '/api/sources/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid source id' });

      const body = req.body ?? {};
      const patch: { name?: string; url?: string; apiKey?: string; enabled?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          return reply.code(400).send({ error: 'name must be a non-empty string' });
        }
        patch.name = body.name.trim();
      }
      if (body.url !== undefined) {
        if (!isValidUrl(body.url)) return reply.code(400).send({ error: 'url must be an http(s) URL' });
        patch.url = body.url;
      }
      if (body.apiKey !== undefined) {
        if (typeof body.apiKey !== 'string') return reply.code(400).send({ error: 'apiKey must be a string' });
        // A masked value means "unchanged" — the UI echoes it back as-is.
        if (!isMaskedKey(body.apiKey)) patch.apiKey = body.apiKey;
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled must be a boolean' });
        patch.enabled = body.enabled;
      }

      const updated = db.updateSource(ctx.db, id, patch);
      if (!updated) return reply.code(404).send({ error: 'source not found' });
      return publicSource(updated, db.getMeta(ctx.db, `last_sync:${id}`));
    },
  );

  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.getSource(ctx.db, id)) return reply.code(404).send({ error: 'source not found' });
    db.deleteSource(ctx.db, id);
    return reply.code(204).send();
  });

  app.post<{ Body: { kind?: unknown; url?: unknown; apiKey?: unknown } }>('/api/sources/test', async (req, reply) => {
    const { kind, url, apiKey } = req.body ?? {};
    if (kind !== 'sonarr' && kind !== 'radarr') {
      return reply.code(400).send({ error: "kind must be 'sonarr' or 'radarr'" });
    }
    if (!isValidUrl(url)) return reply.code(400).send({ error: 'url must be an http(s) URL' });
    if (typeof apiKey !== 'string' || apiKey.trim() === '') return reply.code(400).send({ error: 'apiKey is required' });

    try {
      const client = createClient({ kind, url, apiKey });
      const items = await client.listItems();
      return { ok: true, itemCount: items.length };
    } catch (err) {
      return reply.code(502).send({ ok: false, error: errorMessage(err) });
    }
  });
}
