import { describe, it, expect } from 'vitest';
import { channelLabel, userLabel } from '../client.js';
import type { SlackChannel, SlackUser } from '../client.js';

describe('userLabel', () => {
  it('returns (unknown) for undefined', () => {
    expect(userLabel(undefined)).toBe('(unknown)');
  });

  it('prefers display_name over real_name and name', () => {
    const u: SlackUser = {
      id: 'U1',
      name: 'jdoe',
      real_name: 'John Doe',
      profile: { display_name: 'jay' },
    };
    expect(userLabel(u)).toBe('jay');
  });

  it('falls back to real_name when display_name missing', () => {
    expect(userLabel({ id: 'U1', name: 'jdoe', real_name: 'John Doe' })).toBe('John Doe');
  });

  it('falls back to name when everything else missing', () => {
    expect(userLabel({ id: 'U1', name: 'jdoe' })).toBe('jdoe');
  });

  it('falls back to id when even name is empty', () => {
    expect(userLabel({ id: 'U1', name: '' })).toBe('U1');
  });
});

describe('channelLabel', () => {
  it('returns (unknown) for undefined channel', () => {
    expect(channelLabel(undefined)).toBe('(unknown)');
  });

  it('renders #name for public/private channels', () => {
    const ch: SlackChannel = { id: 'C1', name: 'general' };
    expect(channelLabel(ch)).toBe('#general');
  });

  it('renders @user DM for IMs with a known partner', () => {
    const users = new Map<string, SlackUser>([
      ['U1', { id: 'U1', name: 'jdoe', profile: { display_name: 'jay' } }],
    ]);
    const ch: SlackChannel = { id: 'D1', is_im: true, user: 'U1' };
    expect(channelLabel(ch, users)).toBe('@jay DM');
  });

  it('renders @(unknown) DM when partner not in user map', () => {
    const ch: SlackChannel = { id: 'D1', is_im: true, user: 'U999' };
    expect(channelLabel(ch, new Map())).toBe('@(unknown) DM');
  });

  it('renders [name] for mpim with a name', () => {
    const ch: SlackChannel = { id: 'G1', is_mpim: true, name: 'mpdm-a-b-c' };
    expect(channelLabel(ch)).toBe('[mpdm-a-b-c]');
  });

  it('falls back to id when no name on a non-IM channel', () => {
    expect(channelLabel({ id: 'C9' })).toBe('C9');
  });
});
