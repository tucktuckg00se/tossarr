import type { Database } from 'better-sqlite3';
import type { AppConfig } from './config.js';

/** Everything routes and the app need, injected once at boot. */
export interface AppContext {
  db: Database;
  config: AppConfig;
  /** Kick off a background sync (one source or all). Never throws. */
  triggerSync: (sourceId?: number) => void;
}
