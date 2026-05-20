import { describe, it, expect } from 'vitest';
import { formatBytes, formatFile, formatReactions } from '../format.js';
import type { SlackFile, SlackReaction } from '../client.js';

describe('formatBytes', () => {
  it('renders bytes under 1KB', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('renders KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(46387)).toBe('45.3KB');
  });

  it('renders MB with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0MB');
    expect(formatBytes(5 * 1024 * 1024 + 700_000)).toBe('5.7MB');
  });
});

describe('formatReactions', () => {
  it('joins multiple reactions with double spaces', () => {
    const r: SlackReaction[] = [
      { name: 'taco', count: 1 },
      { name: 'seedling', count: 2 },
    ];
    expect(formatReactions(r)).toBe(':taco: 1  :seedling: 2');
  });

  it('returns empty string for empty array', () => {
    expect(formatReactions([])).toBe('');
  });
});

describe('formatFile', () => {
  it('renders name + mimetype + size', () => {
    const f: SlackFile = {
      id: 'F1',
      name: 'image.png',
      mimetype: 'image/png',
      size: 46387,
    };
    expect(formatFile(f)).toBe('[file: image.png (image/png, 45.3KB)]');
  });

  it('falls back to title then id when name missing', () => {
    expect(formatFile({ id: 'F2', title: 'Screenshot' })).toBe('[file: Screenshot]');
    expect(formatFile({ id: 'F3' })).toBe('[file: F3]');
  });

  it('omits meta parens when no mimetype and no size', () => {
    expect(formatFile({ id: 'F4', name: 'x.txt' })).toBe('[file: x.txt]');
  });
});
