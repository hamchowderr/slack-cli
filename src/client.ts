const API = 'https://slack.com/api';

export interface SlackClient {
  call<T = unknown>(method: string, params?: Record<string, string | number | boolean>): Promise<T>;
  post<T = unknown>(method: string, body: Record<string, unknown>): Promise<T>;
}

export function createClient(token: string): SlackClient {
  return {
    async call<T = unknown>(method: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
      const url = `${API}/${method}${qs.toString() ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
      if (!data.ok) throw new Error(`${method}: ${data.error ?? 'unknown error'}`);
      return data as T;
    },
    async post<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
      const res = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
      if (!data.ok) throw new Error(`${method}: ${data.error ?? 'unknown error'}`);
      return data as T;
    },
  };
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; email?: string };
  is_bot?: boolean;
  deleted?: boolean;
  is_stranger?: boolean;
  team_id?: string;
}

export interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  user?: string;
  created?: number;
}

export interface SlackReaction {
  name: string;
  count: number;
  users?: string[];
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  reactions?: SlackReaction[];
  files?: SlackFile[];
}

let userCache: Map<string, SlackUser> | null = null;
let channelCache: Map<string, SlackChannel> | null = null;

export async function loadUsers(client: SlackClient): Promise<Map<string, SlackUser>> {
  if (userCache) return userCache;
  const map = new Map<string, SlackUser>();
  let cursor: string | undefined;
  do {
    const params: Record<string, string | number> = { limit: 200 };
    if (cursor) params.cursor = cursor;
    const res = await client.call<{ members: SlackUser[]; response_metadata?: { next_cursor?: string } }>(
      'users.list',
      params,
    );
    for (const u of res.members) map.set(u.id, u);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  userCache = map;
  return map;
}

export function userLabel(u: SlackUser | undefined): string {
  if (!u) return '(unknown)';
  return u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || u.id;
}

export async function loadChannels(client: SlackClient): Promise<Map<string, SlackChannel>> {
  if (channelCache) return channelCache;
  const map = new Map<string, SlackChannel>();
  let cursor: string | undefined;
  do {
    const params: Record<string, string | number | boolean> = {
      types: 'public_channel,private_channel,mpim,im',
      exclude_archived: true,
      limit: 200,
    };
    if (cursor) params.cursor = cursor;
    const res = await client.call<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>('conversations.list', params);
    for (const c of res.channels) map.set(c.id, c);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  channelCache = map;
  return map;
}

export async function loadConnectUsers(
  client: SlackClient,
  users: Map<string, SlackUser>,
): Promise<{ added: number; channelsScanned: number }> {
  // users.list does NOT include external members from Slack Connect channels.
  // Walk every Connect-shared channel (incl. shared DMs), pull members via
  // conversations.members, and enrich any unknown user via users.info.
  const auth = await client.call<{ team_id: string }>('auth.test');
  const homeTeam = auth.team_id;
  const channels = await loadChannels(client);
  let added = 0;
  let channelsScanned = 0;
  for (const ch of channels.values()) {
    if (!ch.is_ext_shared && !ch.is_shared) continue;
    channelsScanned++;
    if (ch.is_im) {
      if (ch.user && !users.has(ch.user)) {
        const info = await safeUserInfo(client, ch.user);
        if (info) {
          if (info.team_id && info.team_id !== homeTeam) info.is_stranger = true;
          users.set(info.id, info);
          added++;
        }
      }
      continue;
    }
    let cursor: string | undefined;
    do {
      const params: Record<string, string | number> = { channel: ch.id, limit: 200 };
      if (cursor) params.cursor = cursor;
      try {
        const res = await client.call<{
          members: string[];
          response_metadata?: { next_cursor?: string };
        }>('conversations.members', params);
        for (const uid of res.members) {
          if (users.has(uid)) continue;
          const info = await safeUserInfo(client, uid);
          if (info) {
            if (info.team_id && info.team_id !== homeTeam) info.is_stranger = true;
            users.set(info.id, info);
            added++;
          }
        }
        cursor = res.response_metadata?.next_cursor || undefined;
      } catch {
        cursor = undefined;
      }
    } while (cursor);
  }
  return { added, channelsScanned };
}

async function safeUserInfo(client: SlackClient, userId: string): Promise<SlackUser | undefined> {
  try {
    const res = await client.call<{ user: SlackUser }>('users.info', { user: userId });
    return res.user;
  } catch {
    return undefined;
  }
}

export async function getChannelInfo(client: SlackClient, channelId: string): Promise<SlackChannel | undefined> {
  if (channelCache?.has(channelId)) return channelCache.get(channelId);
  try {
    const res = await client.call<{ channel: SlackChannel }>('conversations.info', { channel: channelId });
    if (channelCache) channelCache.set(res.channel.id, res.channel);
    return res.channel;
  } catch {
    return undefined;
  }
}

export function channelLabel(c: SlackChannel | undefined, users?: Map<string, SlackUser>): string {
  if (!c) return '(unknown)';
  if (c.is_im) {
    const partner = c.user ? users?.get(c.user) : undefined;
    return `@${userLabel(partner)} DM`;
  }
  if (c.is_mpim) return c.name ? `[${c.name}]` : '[group DM]';
  if (c.name) return `#${c.name}`;
  return c.id;
}

function matchUser(u: SlackUser, needle: string): boolean {
  if (u.deleted) return false;
  const candidates = [
    u.id,
    u.name,
    u.real_name,
    u.profile?.display_name,
    u.profile?.real_name,
    u.profile?.email,
  ].filter(Boolean) as string[];
  return candidates.some((c) => c.toLowerCase() === needle || c.toLowerCase().includes(needle));
}

export async function resolveTarget(
  client: SlackClient,
  target: string,
): Promise<{ channelId: string; label: string }> {
  if (/^[CDG][A-Z0-9]+$/.test(target)) return { channelId: target, label: target };

  const users = await loadUsers(client);
  const needle = target.replace(/^@/, '').toLowerCase();

  for (const u of users.values()) {
    if (matchUser(u, needle)) {
      const im = await client.post<{ channel: { id: string } }>('conversations.open', { users: u.id });
      return { channelId: im.channel.id, label: userLabel(u) };
    }
  }

  // Slack Connect / external users aren't in users.list — scan DM partners + users.info
  const dms = await client.call<{ channels: SlackChannel[] }>('conversations.list', { types: 'im', limit: 200 });
  for (const dm of dms.channels) {
    if (!dm.user || users.has(dm.user)) continue;
    try {
      const info = await client.call<{ user: SlackUser }>('users.info', { user: dm.user });
      users.set(info.user.id, info.user);
      if (matchUser(info.user, needle)) {
        return { channelId: dm.id, label: userLabel(info.user) };
      }
    } catch {
      // skip
    }
  }

  throw new Error(`No user or channel matches "${target}"`);
}
