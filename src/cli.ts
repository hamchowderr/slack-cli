import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { getToken } from './config.js';
import {
  channelLabel,
  createClient,
  getChannelInfo,
  loadConnectUsers,
  loadUsers,
  resolveTarget,
  userLabel,
  type SlackChannel,
  type SlackMessage,
  type SlackUser,
} from './client.js';
import { renderMessages, table } from './format.js';
import { parseSlackDate } from './dates.js';

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
  .option(
    '--include-connect',
    'Resolve external Slack Connect DM partners (extra users.info calls).',
    false,
  )
  .action(async (cmdOpts: { limit: string; includeConnect: boolean }) => {
    const { client, opts } = getClient();
    const users = await loadUsers(client);
    if (cmdOpts.includeConnect) {
      const { added, channelsScanned } = await loadConnectUsers(client, users);
      if (!opts.json) {
        process.stderr.write(
          chalk.dim(`(+${added} Connect users from ${channelsScanned} shared channel(s))\n`),
        );
      }
    }
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
  .option('-l, --limit <n>', 'Number of messages per page (max 999)', '30')
  .option('--since <date>', 'Only messages on/after this date. ISO date (2026-05-18) or UNIX ts (1779238218.213609).')
  .option('--before <date>', 'Only messages strictly before this date. Same formats as --since.')
  .option('--all', 'Paginate until all matching messages are pulled (use with --since/--before).', false)
  .option('--no-resolve', 'Pass through raw <@Uxxx> mentions instead of resolving to @display-name.', false)
  .action(
    async (
      target: string,
      cmdOpts: {
        limit: string;
        since?: string;
        before?: string;
        all: boolean;
        resolve: boolean;
      },
    ) => {
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
      const oldest = cmdOpts.since ? parseSlackDate(cmdOpts.since) : undefined;
      const latest = cmdOpts.before ? parseSlackDate(cmdOpts.before) : undefined;
      const pageSize = Math.min(parseInt(cmdOpts.limit, 10), 999);
      const messages: SlackMessage[] = [];
      let cursor: string | undefined;
      do {
        const params: Record<string, string | number | boolean> = {
          channel: channelId,
          limit: pageSize,
          inclusive: true,
        };
        if (oldest !== undefined) params.oldest = oldest;
        if (latest !== undefined) params.latest = latest;
        if (cursor) params.cursor = cursor;
        const res = await client.call<{
          messages: SlackMessage[];
          response_metadata?: { next_cursor?: string };
        }>('conversations.history', params);
        messages.push(...res.messages);
        cursor = cmdOpts.all ? res.response_metadata?.next_cursor || undefined : undefined;
      } while (cursor);
      if (!opts.json) {
        const range =
          oldest !== undefined || latest !== undefined
            ? ` [${cmdOpts.since ?? '…'} → ${cmdOpts.before ?? '…'}]`
            : '';
        process.stdout.write(chalk.dim(`— ${label} (${channelId})${range} —\n\n`));
      }
      process.stdout.write(
        renderMessages(messages, users, {
          json: opts.json,
          noResolve: cmdOpts.resolve === false,
        }) + '\n',
      );
    },
  );

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
  .option(
    '--include-connect',
    'Also include external Slack Connect users (scans shared channels via conversations.members + users.info).',
    false,
  )
  .action(
    async (cmdOpts: { includeBots: boolean; includeDeleted: boolean; includeConnect: boolean }) => {
      const { client, opts } = getClient();
      const users = await loadUsers(client);
      if (cmdOpts.includeConnect) {
        const { added, channelsScanned } = await loadConnectUsers(client, users);
        if (!opts.json) {
          process.stderr.write(
            chalk.dim(`(+${added} Connect users from ${channelsScanned} shared channel(s))\n`),
          );
        }
      }
      const rows: Record<string, string>[] = [];
      const strangerIds = new Set<string>();
      for (const u of users.values()) {
        if (!cmdOpts.includeBots && u.is_bot) continue;
        if (!cmdOpts.includeDeleted && u.deleted) continue;
        if (u.is_stranger) strangerIds.add(u.id);
        rows.push({
          id: u.id,
          name: u.name || '',
          real_name: u.real_name || u.profile?.real_name || '',
          email: u.profile?.email || '',
          team: u.team_id || '',
          connect: u.is_stranger ? 'yes' : '',
        });
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      } else {
        const rendered = table(rows, ['id', 'name', 'real_name', 'email', 'team', 'connect']);
        // Yellow-tint rows for Connect (is_stranger) users so they stand out.
        // Each table row begins with the user ID, so match line-prefix on ID.
        const lines = rendered.split('\n').map((line) => {
          for (const id of strangerIds) {
            if (line.startsWith(id)) return chalk.yellow(line);
          }
          return line;
        });
        process.stdout.write(lines.join('\n') + '\n');
      }
    },
  );

function normalizeEmoji(input: string): string {
  return input.replace(/^:|:$/g, '').trim();
}

async function resolveChannel(
  client: ReturnType<typeof createClient>,
  target: string,
): Promise<{ channelId: string; label: string }> {
  if (target.startsWith('#')) {
    const list = await client.call<{ channels: SlackChannel[] }>('conversations.list', {
      types: 'public_channel,private_channel',
      limit: 500,
    });
    const found = list.channels.find((c) => c.name === target.slice(1));
    if (!found) throw new Error(`Channel ${target} not found`);
    return { channelId: found.id, label: target };
  }
  if (/^[CDG][A-Z0-9]+$/.test(target)) {
    return { channelId: target, label: target };
  }
  return await resolveTarget(client, target);
}

function isMissingScope(err: unknown): boolean {
  return err instanceof Error && /missing_scope/.test(err.message);
}

const SCOPE_HINT_REACTIONS =
  'Add "reactions:write" to the user scopes on the Chowderr CLI Slack app and reinstall, then retry.';
const SCOPE_HINT_FILES =
  'Add "files:write" to the user scopes on the Chowderr CLI Slack app and reinstall, then retry.';

async function uploadAttachments(
  client: ReturnType<typeof createClient>,
  token: string,
  paths: string[],
  channelId: string,
  initialComment?: string,
  threadTs?: string,
): Promise<{ files: { id: string; title?: string; permalink?: string }[] }> {
  // New file-upload flow (files.upload is deprecated):
  //   1. files.getUploadURLExternal -> {upload_url, file_id}
  //   2. POST file bytes to upload_url
  //   3. files.completeUploadExternal -> finalizes + posts to channel
  const uploaded: { id: string; title: string }[] = [];
  for (const p of paths) {
    const buf = await readFile(p);
    const st = await stat(p);
    const fname = basename(p);
    let step1: { upload_url: string; file_id: string };
    try {
      step1 = await client.call<{ upload_url: string; file_id: string }>(
        'files.getUploadURLExternal',
        { filename: fname, length: st.size },
      );
    } catch (e) {
      if (isMissingScope(e)) process.stderr.write(chalk.yellow(SCOPE_HINT_FILES + '\n'));
      throw e;
    }
    const putRes = await fetch(step1.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    if (!putRes.ok) throw new Error(`upload PUT failed for ${p}: ${putRes.status} ${putRes.statusText}`);
    uploaded.push({ id: step1.file_id, title: fname });
  }
  // Single completeUploadExternal posts all uploaded files to channel as one message
  const body: Record<string, unknown> = {
    files: uploaded,
    channel_id: channelId,
  };
  if (initialComment) body.initial_comment = initialComment;
  if (threadTs) body.thread_ts = threadTs;
  // Silence: token is only used for the upload PUT above; client already authed.
  void token;
  const done = await client.post<{ files: { id: string; title?: string; permalink?: string }[] }>(
    'files.completeUploadExternal',
    body,
  );
  return done;
}

program
  .command('react <target> <ts> <emoji>')
  .description('Add a reaction to a message (target: @user, #channel, or channel ID)')
  .action(async (target: string, ts: string, emoji: string) => {
    const { client, opts } = getClient();
    const { channelId, label } = await resolveChannel(client, target);
    const name = normalizeEmoji(emoji);
    try {
      await client.post('reactions.add', { channel: channelId, timestamp: ts, name });
    } catch (e) {
      if (isMissingScope(e)) process.stderr.write(chalk.yellow(SCOPE_HINT_REACTIONS + '\n'));
      throw e;
    }
    if (opts.json) process.stdout.write(JSON.stringify({ ok: true, channel: channelId, ts, name }, null, 2) + '\n');
    else process.stdout.write(chalk.green(`Reacted :${name}: on ${label} (ts=${ts})\n`));
  });

program
  .command('update <target> <ts> <text...>')
  .description('Edit one of your own messages (chat.update). Requires --yes.')
  .option('-y, --yes', 'Skip confirmation', false)
  .action(async (target: string, ts: string, textParts: string[], cmdOpts: { yes: boolean }) => {
    const { client, opts } = getClient();
    const { channelId, label } = await resolveChannel(client, target);
    const text = textParts.join(' ');
    if (!cmdOpts.yes) {
      process.stderr.write(chalk.yellow(`About to edit message ${ts} in ${label} (${channelId}):\n`));
      process.stderr.write(`  ${text}\n`);
      process.stderr.write(chalk.dim('Pass --yes to skip this prompt and update.\n'));
      process.stderr.write(chalk.red('Aborted (no --yes).\n'));
      process.exit(2);
    }
    const res = await client.post<{ ts: string; channel: string; text?: string }>('chat.update', {
      channel: channelId,
      ts,
      text,
    });
    if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else process.stdout.write(chalk.green(`Updated message in ${label} (ts=${res.ts})\n`));
  });

program
  .command('delete <target> <ts>')
  .description('Delete one of your own messages (chat.delete). Requires --yes.')
  .option('-y, --yes', 'Skip confirmation', false)
  .action(async (target: string, ts: string, cmdOpts: { yes: boolean }) => {
    const { client, opts } = getClient();
    const { channelId, label } = await resolveChannel(client, target);
    if (!cmdOpts.yes) {
      process.stderr.write(chalk.yellow(`About to delete message ${ts} in ${label} (${channelId}).\n`));
      process.stderr.write(chalk.dim('Pass --yes to skip this prompt and delete.\n'));
      process.stderr.write(chalk.red('Aborted (no --yes).\n'));
      process.exit(2);
    }
    const res = await client.post<{ ts: string; channel: string }>('chat.delete', {
      channel: channelId,
      ts,
    });
    if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else process.stdout.write(chalk.green(`Deleted message in ${label} (ts=${ts})\n`));
  });

program
  .command('react-remove <target> <ts> <emoji>')
  .description('Remove a reaction from a message')
  .action(async (target: string, ts: string, emoji: string) => {
    const { client, opts } = getClient();
    const { channelId, label } = await resolveChannel(client, target);
    const name = normalizeEmoji(emoji);
    try {
      await client.post('reactions.remove', { channel: channelId, timestamp: ts, name });
    } catch (e) {
      if (isMissingScope(e)) process.stderr.write(chalk.yellow(SCOPE_HINT_REACTIONS + '\n'));
      throw e;
    }
    if (opts.json) process.stdout.write(JSON.stringify({ ok: true, channel: channelId, ts, name }, null, 2) + '\n');
    else process.stdout.write(chalk.green(`Removed :${name}: from ${label} (ts=${ts})\n`));
  });

program
  .command('send <target> <message...>')
  .description('Send a message to a user (@name) or channel (#name or ID)')
  .option('-y, --yes', 'Skip confirmation', false)
  .option('--thread <ts>', 'Reply inside an existing thread (sets thread_ts).')
  .option(
    '--reply-broadcast',
    'When replying in a thread, also surface the reply to the channel (requires --thread).',
    false,
  )
  .option(
    '-a, --attach <file>',
    'Attach a file (repeat for multiple). Uses files.getUploadURLExternal + completeUploadExternal flow.',
    (value, prev: string[]) => (prev ? [...prev, value] : [value]),
  )
  .action(
    async (
      target: string,
      messageParts: string[],
      cmdOpts: {
        yes: boolean;
        thread?: string;
        replyBroadcast: boolean;
        attach?: string[];
      },
    ) => {
      const { client, opts } = getClient();
      const text = messageParts.join(' ');
      if (cmdOpts.replyBroadcast && !cmdOpts.thread) {
        throw new Error('--reply-broadcast requires --thread <ts>');
      }
      const { channelId, label } = await resolveChannel(client, target);
      const attachments = cmdOpts.attach ?? [];
      if (!cmdOpts.yes) {
        const where = cmdOpts.thread ? `${label} (${channelId}) thread ${cmdOpts.thread}` : `${label} (${channelId})`;
        process.stderr.write(chalk.yellow(`About to send to ${where}:\n`));
        process.stderr.write(`  ${text}\n`);
        if (attachments.length > 0) {
          process.stderr.write(chalk.yellow(`Attachments:\n`));
          for (const a of attachments) process.stderr.write(`  ${a}\n`);
        }
        process.stderr.write(chalk.dim('Pass --yes to skip this prompt and send.\n'));
        process.stderr.write(chalk.red('Aborted (no --yes).\n'));
        process.exit(2);
      }
      if (attachments.length > 0) {
        const done = await uploadAttachments(
          client,
          opts.token ?? '',
          attachments,
          channelId,
          text || undefined,
          cmdOpts.thread,
        );
        if (opts.json) process.stdout.write(JSON.stringify(done, null, 2) + '\n');
        else
          process.stdout.write(
            chalk.green(`Sent ${attachments.length} attachment(s) to ${label}\n`),
          );
        return;
      }
      const body: Record<string, unknown> = { channel: channelId, text };
      if (cmdOpts.thread) body.thread_ts = cmdOpts.thread;
      if (cmdOpts.replyBroadcast) body.reply_broadcast = true;
      const res = await client.post<{ ts: string; channel: string }>('chat.postMessage', body);
      if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      else {
        const where = cmdOpts.thread ? `${label} (thread ${cmdOpts.thread})` : label;
        process.stdout.write(chalk.green(`Sent to ${where} at ${res.ts}\n`));
      }
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`Error: ${msg}\n`));
  process.exit(1);
});
