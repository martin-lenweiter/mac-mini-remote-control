import { describe, expect, it } from 'vitest';
import { formatBytes, formatIdle, formatUptime } from '@/lib/format';

describe('formatIdle', () => {
  it('formats across units', () => {
    expect(formatIdle(5)).toBe('5s');
    expect(formatIdle(90)).toBe('1m');
    expect(formatIdle(3600)).toBe('1h');
    expect(formatIdle(90_000)).toBe('1d');
  });
});

describe('formatBytes', () => {
  it('formats bytes as binary gigabytes', () => {
    expect(formatBytes(16 * 1024 ** 3)).toBe('16.0 GB');
  });
});

describe('formatUptime', () => {
  it('formats the two most useful units', () => {
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3_900)).toBe('1h 5m');
    expect(formatUptime(90_000)).toBe('1d 1h');
  });
});
