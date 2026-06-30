import { describe, expect, it } from 'vitest';
import { formatIdle } from '@/lib/format';

describe('formatIdle', () => {
  it('formats across units', () => {
    expect(formatIdle(5)).toBe('5s');
    expect(formatIdle(90)).toBe('1m');
    expect(formatIdle(3600)).toBe('1h');
    expect(formatIdle(90_000)).toBe('1d');
  });
});
