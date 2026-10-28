import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDb } from '../src/db.js';
import type { Settings } from '../src/types.js';

/** Fresh database in a temp dir (exercises the real open + migrate path). */
export function freshDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tossarr-test-'));
  return { db: openDb(dir), dir };
}

export function disposeDb(db: Database, dir: string): void {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

/** Listen on an ephemeral port; returns the base URL and a close fn. */
export async function listenRandom(app: FastifyInstance): Promise<{ url: string; close: () => Promise<void> }> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('expected a numeric port');
  return { url: `http://127.0.0.1:${addr.port}`, close: () => app.close() };
}

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  dir: string;
  config: AppConfig;
  /** sourceIds passed to triggerSync (undefined = sync all), in call order. */
  triggerSyncs: Array<number | undefined>;
  close: () => Promise<void>;
}

/** The real app against a fresh temp DB, with a recording no-op triggerSync. */
export async function createTestApp(settings?: Partial<Settings>): Promise<TestApp> {
  const { db, dir } = freshDb();
  const config: AppConfig = {
    port: 0,
    configDir: dir,
    settings: { syncIntervalHours: 6, keepReappearDays: 30, ...settings },
  };
  const triggerSyncs: Array<number | undefined> = [];
  const ctx: AppContext = { db, config, triggerSync: (sourceId) => triggerSyncs.push(sourceId) };
  const app = await buildApp(ctx, { logger: false });
  return { app, db, dir, config, triggerSyncs, close: () => app.close() };
}
