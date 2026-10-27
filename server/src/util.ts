export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Coerce an untrusted query param to an integer within [min, max], falling back to `def`. */
export function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

const MASK_SHORT = '••••';

/** Mask an API key for display: `abcd…` or all-dots for very short keys. */
export function maskApiKey(key: string): string {
  return key.length <= 6 ? MASK_SHORT : `${key.slice(0, 4)}…`;
}

/** True when a submitted key is one of our masks, i.e. "leave unchanged". */
export function isMaskedKey(value: string): boolean {
  return value === MASK_SHORT || (value.length === 5 && value.endsWith('…'));
}
