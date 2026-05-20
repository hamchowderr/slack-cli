import { describe, it, expect } from 'vitest';
import { parseSlackDate } from '../dates.js';

describe('parseSlackDate', () => {
  it('passes through raw Slack timestamps unchanged', () => {
    expect(parseSlackDate('1779238218')).toBe('1779238218');
    expect(parseSlackDate('1779238218.213609')).toBe('1779238218.213609');
  });

  it('converts ISO date strings to UNIX seconds with fractional', () => {
    const expected = (new Date('2026-05-19T00:00:00Z').getTime() / 1000).toFixed(6);
    expect(parseSlackDate('2026-05-19T00:00:00Z')).toBe(expected);
  });

  it('throws on unparseable input', () => {
    expect(() => parseSlackDate('not a date')).toThrow(/Invalid date/);
  });
});
