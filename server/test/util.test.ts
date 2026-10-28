import { describe, expect, it } from 'vitest';
import { clampInt, isMaskedKey, maskApiKey } from '../src/util.js';

describe('maskApiKey', () => {
  it('masks long keys as first four chars plus ellipsis', () => {
    expect(maskApiKey('tossarr-mock-sonarr-key')).toBe('toss…');
  });

  it('masks keys of six chars or fewer fully', () => {
    expect(maskApiKey('abc')).toBe('••••');
    expect(maskApiKey('123456')).toBe('••••');
  });

  it('keeps the first four chars for seven-char keys', () => {
    expect(maskApiKey('1234567')).toBe('1234…');
  });
});

describe('isMaskedKey', () => {
  it('recognizes both mask formats', () => {
    expect(isMaskedKey('••••')).toBe(true);
    expect(isMaskedKey('toss…')).toBe(true);
  });

  it('rejects real keys', () => {
    expect(isMaskedKey('tossarr-mock-sonarr-key')).toBe(false);
    expect(isMaskedKey('abcd')).toBe(false);
    expect(isMaskedKey('')).toBe(false);
  });
});

describe('clampInt', () => {
  it('passes through in-range integers, including numeric strings', () => {
    expect(clampInt(5, 20, 1, 50)).toBe(5);
    expect(clampInt('5', 20, 1, 50)).toBe(5);
    expect(clampInt(1, 20, 1, 50)).toBe(1);
    expect(clampInt(50, 20, 1, 50)).toBe(50);
  });

  it('falls back to the default when out of range or not an integer', () => {
    expect(clampInt(0, 20, 1, 50)).toBe(20);
    expect(clampInt(51, 20, 1, 50)).toBe(20);
    expect(clampInt(2.5, 20, 1, 50)).toBe(20);
    expect(clampInt('abc', 20, 1, 50)).toBe(20);
    expect(clampInt(undefined, 20, 1, 50)).toBe(20);
  });
});
