import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveSettings } from '../src/config.js';

const ENV_KEYS = ['TOSSARR_CONFIG_DIR', 'SYNC_INTERVAL_HOURS', 'KEEP_REAPPEAR_DAYS', 'TOSSARR_PORT'] as const;

let dir: string;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(path.join(os.tmpdir(), 'tossarr-cfg-'));
  process.env.TOSSARR_CONFIG_DIR = dir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function writeSettings(obj: unknown): void {
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj));
}

describe('loadConfig', () => {
  it('falls back to defaults with no env and no settings file', () => {
    const config = loadConfig();
    expect(config.port).toBe(8901);
    expect(config.configDir).toBe(dir);
    expect(config.settings).toEqual({ syncIntervalHours: 6, keepReappearDays: 30 });
  });

  it('reads settings.json when env vars are absent', () => {
    writeSettings({ syncIntervalHours: 2, keepReappearDays: 10 });
    const config = loadConfig();
    expect(config.settings).toEqual({ syncIntervalHours: 2, keepReappearDays: 10 });
  });

  it('lets env vars win over settings.json', () => {
    writeSettings({ syncIntervalHours: 2, keepReappearDays: 10 });
    process.env.SYNC_INTERVAL_HOURS = '3';
    const config = loadConfig();
    expect(config.settings).toEqual({ syncIntervalHours: 3, keepReappearDays: 10 });
  });

  it('ignores invalid env values and falls through', () => {
    writeSettings({ syncIntervalHours: 2 });
    process.env.SYNC_INTERVAL_HOURS = 'abc';
    process.env.KEEP_REAPPEAR_DAYS = '-4';
    const config = loadConfig();
    expect(config.settings).toEqual({ syncIntervalHours: 2, keepReappearDays: 30 });
  });

  it('honors TOSSARR_PORT', () => {
    process.env.TOSSARR_PORT = '9000';
    expect(loadConfig().port).toBe(9000);
  });

  it('survives a corrupt settings file', () => {
    writeFileSync(path.join(dir, 'settings.json'), '{not json');
    const config = loadConfig();
    expect(config.settings).toEqual({ syncIntervalHours: 6, keepReappearDays: 30 });
  });
});

describe('saveSettings', () => {
  it('writes settings.json and updates the in-memory copy', () => {
    const config = loadConfig();
    saveSettings(config, { syncIntervalHours: 12, keepReappearDays: 45 });

    expect(config.settings).toEqual({ syncIntervalHours: 12, keepReappearDays: 45 });
    expect(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toEqual({
      syncIntervalHours: 12,
      keepReappearDays: 45,
    });

    // A fresh load picks the saved values up.
    expect(loadConfig().settings).toEqual({ syncIntervalHours: 12, keepReappearDays: 45 });
  });
});
