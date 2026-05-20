import { Command } from 'commander';
import chalk from 'chalk';
import { getToken } from './config.js';
import {
  channelLabel,
  createClient,
  getChannelInfo,
  loadUsers,
  resolveTarget,
  userLabel,
  type SlackChannel,
  type SlackMessage,
  type SlackUser,
} from './client.js';
import { renderMessages, table } from './format.js';

const program = new Command();

program
  .name('slk')
  .description('Personal Slack CLI — read DMs, channels, search, send messages')
  .version('0.1.0')
  .option('--token <token>', 'Slack user token (xoxp-...) — overrides Infisical/env')
  .option('--json', 'Output as JSON', false);

interface GlobalOpts {
  token?: string;
  json?: boolean;
}

function getClient(): { client: ReturnType<typeof createClient>; opts: GlobalOpts } {
  const opts = program.opts<GlobalOpts>();
  const token = getToken(opts.token);
  return { client: createClient(token), opts };
}

program
  .command('whoami')
  .description('Show authenticated user')
  .action(async () => {
    const { client, opts } = getClient();
    const res = await client.call<{ user: string; team: string; user_id: string; team_id: string; url: string }>(
      'auth.test',
    );
    if (opts.json) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(
        `${chalk.bold(res.user)} on ${chalk.cyan(res.team)}\n` +
          `  user_id: ${res.user_id}\n  team_id: ${res.team_id}\n  url:     ${res.url}\n`,
      );
    }
  });

program
  .command('dms')
  .description('List your direct messages')
  .option('-l, --limit <n>', 'Max DMs to fetch', '100')
  .action(async (cmdOpts: { limit: string }) => {
    const { client, opts } = getClient();
    const users = await loadUsers(client);
    const res = await client.call<{ channels: SlackChannel[] }>('conversations.list', {
      types: 'im',
      limit: parseInt(cmdOpts.limit, 10),
    });
    const rows = res.channels.map((c) => ({
      with: c.user ? userLabel(users.get(c.user)) : '(unknown)',
      channel: c.id,
      user_id: c.user || '',
    }));
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(table(rows, ['with', 'channel', 'user_id']) + '\n');
  });

program
  .command('groups')
  .description('List group DMs (mpim)')
  .action(async () => {
    const { client, opts } = getClient();
    const users = await loadUsers(client);
    const res = await client.call<{ channels: (SlackChannel & { name?: string })[] }>('conversations.list', {
      types: 'mpim',
      limit: 100,
    });
    const enriched = await Promise.all(
      res.channels.map(async (c) => {
        const m = await client.call<{ members: string[] }>('conversations.members', { channel: c.id, limit: 50 });
        return {
          channel: c.id,
          members: m.members.map((id) => userLabel(users.get(id))).join(', '),
        };
      }),
    );
    if (opts.json) process.stdout.write(JSON.stringify(enriched, null, 2) + '\n');
    else process.stdout.write(table(enriched, ['channel', 'members']) + '\n');
  });

program
  .command('channels')
  .description('List channels you are in')
  .option('-a, --all', 'Include channels you are not a member of', false)
  .action(async (cmdOpts: { all: boolean }) => {
    const { client, opts } = getClient();
    const res = await client.call<{ channels: SlackChannel[] }>('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    });
    const filtered = cmdOpts.all
      ? res.channels
      : res.channels.filter((c) => (c as SlackChannel & { is_member?: boolean }).is_member);
    const rows = filtered.map((c) => ({
      channel: `#${c.name || ''}`,
      id: c.id,
      private: c.is_private ? 'yes' : '',
    }));
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(table(rows, ['channel', 'id', 'private']) + '\n');
  });

program
  .command('read <target>')
  .description('Read messages from a DM (@user, name, channel ID, or #channel)')
  .option('-l, --limit <n>', 'Number of messages', '30')
  .action(async (target: string, cmdOpts: { limit: string }) => {
    const { client, opts } = getClient();
    let channelId: string;
    let label: string;
    if (target.startsWith('#')) {
      const list = await client.call<{ channels: SlackChannel[] }>('conversations.list', {
        types: 'public_channel,private_channel',
        limit: 500,
      });
      const wanted = target.slice(1);
      const found = list.channels.find((c) => c.name === wanted);
      if (!found) throw new Error(`Channel ${target} not found`);
      channelId = found.id;
      label = target;
    } else if (/^[CDG][A-Z0-9]+$/.test(target)) {
      channelId = target;
      const users = await loadUsers(client);
      const info = await getChannelInfo(client, channelId);
      label = channelLabel(info, users);
    } else {
      ({ channelId, label } = await resolveTarget(client, target));
    }
    const users = await loadUsers(client);
    const res = await client.call<{ messages: SlackMessage[] }>('conversations.history', {
      channel: channelId,
      limit: parseInt(cmdOpts.limit, 10),
    });
    if (!opts.json) process.stdout.write(chalk.dim(`— ${label} (${channelId}) —\n\n`));
    process.stdout.write(renderMessages(res.messages, users, { json: opts.json }) + '\n');
  });

program
  .command('channel <id>')
  .description('Resolve a channel ID to its info (name, type, members count). Useful for downstream tools that received a channel ID from a message.')
  .action(async (id: string) => {
    const { client, opts } = getClient();
    const info = await getChannelInfo(client, id);
    if (!info) throw new Error(`Channel ${id} not found (or not accessible to this token)`);
    const users = await loadUsers(client);
    const label = channelLabel(info, users);
    const kind = info.is_im
      ? 'im'
      : info.is_mpim
        ? 'mpim'
        : info.is_private
          ? 'private_channel'
          : 'public_channel';
    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          {
            id: info.id,
            name: info.name ?? null,
            label,
            kind,
            is_shared: info.is_shared ?? false,
            is_ext_shared: info.is_ext_shared ?? false,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      process.stdout.write(
        `${chalk.bold(label)}\n  id:    ${info.id}\n  kind:  ${kind}\n` +
          (info.is_ext_shared ? `  ${chalk.yellow('externally shared (Slack Connect)')}\n` : ''),
      );
    }
  });

program
  .command('thread <channel> <ts>')
  .description('Read replies in a thread')
  .action(async (channel: string, ts: string) => {
    const { client, opts } = getClient();
    const users = await loadUsers(client);
    const res = await client.call<{ messages: SlackMessage[] }>('conversations.replies', {
      channel,
      ts,
      limit: 100,
    });
    process.stdout.write(renderMessages(res.messages, users, { json: opts.json }) + '\n');
  });

program
  .command('search <query...>')
  .description('Search messages across the workspace')
  .option('-l, --limit <n>', 'Number of results', '20')
  .action(async (queryParts: string[], cmdOpts: { limit: string }) => {
    const { client, opts } = getClient();
    const query = queryParts.join(' ');
    const res = await client.call<{
      messages: { total: number; matches: (SlackMessage & { channel: { id: string; name?: string }; permalink?: string })[] };
    }>('search.messages', { query, count: parseInt(cmdOpts.limit, 10) });
    if (opts.json) {
      process.stdout.write(JSON.stringify(res.messages, null, 2) + '\n');
      return;
    }
    process.stdout.write(chalk.dim(`${res.messages.total} matches\n\n`));
    for (const m of res.messages.matches) {
      const where = m.channel.name ? `#${m.channel.name}` : m.channel.id;
      process.stdout.write(`${chalk.cyan(where)}  ${chalk.bold(m.user || '?')}\n  ${m.text || ''}\n`);
      if (m.permalink) process.stdout.write(chalk.dim(`  ${m.permalink}\n`));
      process.stdout.write('\n');
    }
  });

program
  .command('users')
  .description('List workspace users')
  .option('--include-bots', 'Include bots', false)
  .option('--include-deleted', 'Include deleted users', false)
  .action(async (cmdOpts: { includeBots: boolean; includeDeleted: boolean }) => {
    const { client, opts } = getClient();
    const users = await loadUsers(client);
    const rows: Record<string, string>[] = [];
    for (const u of users.values()) {
      if (!cmdOpts.includeBots && u.is_bot) continue;
      if (!cmdOpts.includeDeleted && u.deleted) continue;
      rows.push({
        id: u.id,
        name: u.name || '',
        real_name: u.real_name || u.profile?.real_name || '',
        email: u.profile?.email || '',
      });
    }
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(table(rows, ['id', 'name', 'real_name', 'email']) + '\n');
  });

program
  .command('send <target> <message...>')
  .description('Send a message to a user (@name) or channel (#name or ID)')
  .option('-y, --yes', 'Skip confirmation', false)
  .action(async (target: string, messageParts: string[], cmdOpts: { yes: boolean }) => {
    const { client, opts } = getClient();
    const text = messageParts.join(' ');
    let channelId: string;
    let label: string;
    if (target.startsWith('#')) {
      const list = await client.call<{ channels: SlackChannel[] }>('conversations.list', {
        types: 'public_channel,private_channel',
        limit: 500,
      });
      const found = list.channels.find((c) => c.name === target.slice(1));
      if (!found) throw new Error(`Channel ${target} not found`);
      channelId = found.id;
      label = target;
    } else if (/^[CDG][A-Z0-9]+$/.test(target)) {
      channelId = target;
      label = target;
    } else {
      ({ channelId, label } = await resolveTarget(client, target));
    }
    if (!cmdOpts.yes) {
      process.stderr.write(chalk.yellow(`About to send to ${label} (${channelId}):\n`));
      process.stderr.write(`  ${text}\n`);
      process.stderr.write(chalk.dim('Pass --yes to skip this prompt and send.\n'));
      process.stderr.write(chalk.red('Aborted (no --yes).\n'));
      process.exit(2);
    }
    const res = await client.post<{ ts: string; channel: string }>('chat.postMessage', {
      channel: channelId,
      text,
    });
    if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else process.stdout.write(chalk.green(`Sent to ${label} at ${res.ts}\n`));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`Error: ${msg}\n`));
  process.exit(1);
});
