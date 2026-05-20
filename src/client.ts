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
}

export interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  user?: string;
  created?: number;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
}

let userCache: Map<string, SlackUser> | null = null;

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
