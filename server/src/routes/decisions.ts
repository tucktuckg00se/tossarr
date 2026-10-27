import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import * as db from '../db.js';
import { toItem } from '../items.js';
import { confirmRemoval } from '../removals.js';

export async function decisionsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Record a keep/remove decision for one item.
  app.post<{ Params: { itemId: string }; Body: { decision?: unknown } }>('/api/decisions/:itemId', async (req, reply) => {
    const { itemId } = req.params;
    if (!db.getItemWithSource(ctx.db, itemId)) return reply.code(404).send({ error: 'unknown item' });

    const decision = (req.body ?? {}).decision;
    if (decision !== 'keep' && decision !== 'remove') {
      return reply.code(400).send({ error: "decision must be 'keep' or 'remove'" });
    }

    const nowIso = new Date().toISOString();
    let nextDue: string | undefined;
    if (decision === 'keep') {
      nextDue = new Date(Date.now() + ctx.config.settings.keepReappearDays * 86_400_000).toISOString();
    }
    db.setDecision(ctx.db, itemId, decision, nowIso, nextDue);
    return { itemId, decision, decidedAt: nowIso, ...(nextDue !== undefined ? { nextDue } : {}) };
  });

  // Remove the most recent pending decision; returns the item so the UI can re-show it.
  app.post('/api/decisions/undo', async (_req, reply) => {
    const latest = db.latestPendingDecision(ctx.db);
    if (!latest) return reply.code(404).send({ error: 'nothing to undo' });

    db.deleteDecision(ctx.db, latest.itemId);
    const item = db.getItemWithSource(ctx.db, latest.itemId);
    if (!item) return reply.code(410).send({ error: 'item no longer exists upstream' });
    return { item: toItem(item) };
  });

  // Confirm a pending removal: delete upstream (metadata + files), then tombstone.
  app.post<{ Params: { itemId: string } }>('/api/decisions/:itemId/confirm', async (req, reply) => {
    const { itemId } = req.params;
    const decision = db.getDecision(ctx.db, itemId);
    if (!decision || decision.decision !== 'remove' || decision.confirmed) {
      return reply.code(409).send({ error: 'item is not a pending removal' });
    }

    const parts = db.splitItemId(itemId);
    const source = parts ? db.getSource(ctx.db, parts.sourceId) : null;
    if (!source) return reply.code(404).send({ error: 'source no longer exists' });

    const outcome = await confirmRemoval(ctx.db, source, itemId);
    if (!outcome.ok) return reply.code(502).send({ error: outcome.error ?? 'upstream delete failed' });
    return { ok: true, ...(outcome.alreadyGone ? { alreadyGone: true } : {}) };
  });

  // Confirm every pending removal; per-item failures are reported, not fatal.
  app.post('/api/decisions/confirm-all', async () => {
    const pending = db.pendingRemovals(ctx.db);
    let confirmed = 0;
    const failed: Array<{ itemId: string; error: string }> = [];
    for (const row of pending) {
      const source = db.getSource(ctx.db, row.item.sourceId);
      if (!source) {
        failed.push({ itemId: row.itemId, error: 'source no longer exists' });
        continue;
      }
      const outcome = await confirmRemoval(ctx.db, source, row.itemId);
      if (outcome.ok) confirmed += 1;
      else failed.push({ itemId: row.itemId, error: outcome.error ?? 'upstream delete failed' });
    }
    return { confirmed, failed };
  });

  // Clear all unconfirmed decisions (keeps + pending removals). Confirmed
  // removals are preserved — they are the permanent log.
  app.post('/api/decisions/reset', async () => {
    const cleared = db.resetDecisions(ctx.db);
    return { ok: true, cleared };
  });

  // Clear a single decision without touching upstream.
  app.delete<{ Params: { itemId: string } }>('/api/decisions/:itemId', async (req, reply) => {
    if (!db.deleteDecision(ctx.db, req.params.itemId)) {
      return reply.code(404).send({ error: 'no decision for this item' });
    }
    return reply.code(204).send();
  });
}
