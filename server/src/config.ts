import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from './types.js';

export interface AppConfig {
  port: number;
  configDir: string;
  settings: Settings;
}

const DEFAULTS: Settings = { syncIntervalHours: 6, keepReappearDays: 30 };

function numFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function numFromJson(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Load configuration. Environment variables win over /config/settings.json,
 * which wins over defaults. The settings file is created on first save.
 */
export function loadConfig(): AppConfig {
  const configDir = process.env.TOSSARR_CONFIG_DIR ?? '/config';
  mkdirSync(configDir, { recursive: true });

  let fileSettings: Partial<Settings> = {};
  const settingsPath = path.join(configDir, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      fileSettings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<Settings>;
    } catch {
      // Corrupt settings file — fall back to defaults rather than crash boot.
      fileSettings = {};
    }
  }

  const settings: Settings = {
    syncIntervalHours:
      numFromEnv('SYNC_INTERVAL_HOURS') ??
      numFromJson(fileSettings.syncIntervalHours) ??
      DEFAULTS.syncIntervalHours,
    keepReappearDays:
      numFromEnv('KEEP_REAPPEAR_DAYS') ??
      numFromJson(fileSettings.keepReappearDays) ??
      DEFAULTS.keepReappearDays,
  };

  return { port: numFromEnv('TOSSARR_PORT') ?? 8901, configDir, settings };
}

/** Persist settings to /config/settings.json and update the in-memory copy. */
export function saveSettings(config: AppConfig, settings: Settings): void {
  mkdirSync(config.configDir, { recursive: true });
  writeFileSync(
    path.join(config.configDir, 'settings.json'),
    JSON.stringify(settings, null, 2) + '\n',
  );
  config.settings = settings;
}
