import { describe, expect, it } from 'vitest';
import { slugify } from '@/lib/naming';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Fix Login Redirect')).toBe('fix-login-redirect');
  });

  it('takes the first non-empty line and trims hyphens', () => {
    expect(slugify('\n  dark-mode-toggle  \n')).toBe('dark-mode-toggle');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('Add OAuth 2.0!!')).toBe('add-oauth-2-0');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(slugify('—')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('caps length at 40 chars with no trailing hyphen', () => {
    const out = slugify('a'.repeat(50));
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });
});
