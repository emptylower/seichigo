import { describe, it, expect } from 'vitest';
import { isValidTheme, DEFAULT_THEME_WIDTH, DEFAULT_THEME_HEIGHT } from '@/components/map/types';

describe('AnitabiTheme type guard', () => {
  it('should accept valid theme with all fields', () => {
    const theme = {
      ids: ['a', 'b'],
      src: 'https://example.com/theme.png',
      w: 72,
      h: 54,
    };
    expect(isValidTheme(theme)).toBe(true);
  });

  it('should accept valid theme without w/h (optional)', () => {
    const theme = {
      ids: ['a'],
      src: 'https://example.com/theme.png',
    };
    expect(isValidTheme(theme)).toBe(true);
  });

  it('should reject null', () => {
    expect(isValidTheme(null)).toBe(false);
  });

  it('should reject undefined', () => {
    expect(isValidTheme(undefined)).toBe(false);
  });

  it('should reject empty object', () => {
    expect(isValidTheme({})).toBe(false);
  });

  it('should reject theme with empty ids array', () => {
    const theme = {
      ids: [],
      src: 'https://example.com/theme.png',
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with empty src string', () => {
    const theme = {
      ids: ['a'],
      src: '',
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with non-array ids', () => {
    const theme = {
      ids: 'not-an-array',
      src: 'https://example.com/theme.png',
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with non-string src', () => {
    const theme = {
      ids: ['a'],
      src: 123,
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with non-string elements in ids', () => {
    const theme = {
      ids: ['a', 123, 'b'],
      src: 'https://example.com/theme.png',
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with negative width', () => {
    const theme = {
      ids: ['a'],
      src: 'https://example.com/theme.png',
      w: -10,
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with zero width', () => {
    const theme = {
      ids: ['a'],
      src: 'https://example.com/theme.png',
      w: 0,
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with non-number width', () => {
    const theme = {
      ids: ['a'],
      src: 'https://example.com/theme.png',
      w: '72',
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should reject theme with negative height', () => {
    const theme = {
      ids: ['a'],
      src: 'https://example.com/theme.png',
      h: -10,
    };
    expect(isValidTheme(theme)).toBe(false);
  });

  it('should export default constants', () => {
    expect(DEFAULT_THEME_WIDTH).toBe(72);
    expect(DEFAULT_THEME_HEIGHT).toBe(54);
  });
});
