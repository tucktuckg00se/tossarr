import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db.js';
import { syncAll, syncOne } from './sync.js';
import { errorMessage } from './util.js';

const MIN_SYNC_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDb(config.configDir);

  /** undefined means "all sources". */
  type SyncTarget = number | undefined;
  const queue: SyncTarget[] = [];
  let running = false;

  async function runSync(sourceId?: number): Promise<void> {
    try {
      const results = sourceId === undefined ? await syncAll(database) : [await syncOne(database, sourceId)];
      for (const r of results) {
        if (r.error) app.log.warn({ source: r.sourceId, error: r.error }, 'sync failed');
        else app.log.info({ source: r.sourceId, added: r.added, updated: r.updated, pruned: r.pruned }, 'sync complete');
      }
    } catch (err) {
      app.log.error({ err: errorMessage(err) }, 'sync run failed');
    }
  }

  /** Queue a sync. Runs happen one at a time; repeat requests coalesce. */
  function enqueueSync(sourceId?: number): void {
    if (sourceId === undefined || queue.includes(undefined)) {
      // A full sync covers everything else pending.
      queue.length = 0;
      queue.push(undefined);
    } else if (!queue.includes(sourceId)) {
      queue.push(sourceId);
    }
    void pump();
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        await runSync(queue.shift());
      }
    } finally {
      running = false;
    }
  }

  const ctx: AppContext = { db: database, config, triggerSync: enqueueSync };
  const app = await buildApp(ctx);

  await app.listen({ port: config.port, host: '0.0.0.0' });

  // Initial sync ~1s after boot; every later cycle re-reads the configured
  // interval so changes made in the UI apply without a restart.
  let timer: NodeJS.Timeout | undefined;
  function scheduleNext(delayMs: number): void {
    timer = setTimeout(() => {
      enqueueSync();
      const nextMs = Math.max(MIN_SYNC_INTERVAL_MS, config.settings.syncIntervalHours * 3_600_000);
      scheduleNext(nextMs);
    }, delayMs);
  }
  scheduleNext(1_000);

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — shutting down`);
    if (timer !== undefined) clearTimeout(timer);
    try {
      await app.close();
      database.close();
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`tossarr failed to start: ${errorMessage(err)}`);
  process.exit(1);
});
