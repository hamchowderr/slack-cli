import columnify from 'columnify';
import chalk from 'chalk';
import type { SlackMessage, SlackReaction, SlackUser } from './client.js';

export function formatTs(ts: string): string {
  const ms = Math.floor(parseFloat(ts) * 1000);
  const d = new Date(ms);
  return d.toLocaleString();
}

export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return chalk.dim('(no results)');
  return columnify(rows, {
    columns,
    columnSplitter: '  ',
    truncate: true,
    config: { text: { maxWidth: 80 } },
  });
}

export function renderMessages(
  messages: SlackMessage[],
  users: Map<string, SlackUser>,
  options: { json?: boolean } = {},
): string {
  if (options.json) return JSON.stringify(messages, null, 2);
  if (messages.length === 0) return chalk.dim('(no messages)');
  const ordered = [...messages].reverse();
  const lines: string[] = [];
  for (const m of ordered) {
    const who = m.user ? users.get(m.user) : undefined;
    const name = who ? who.profile?.display_name || who.real_name || who.name || m.user : m.user || 'system';
    const when = formatTs(m.ts);
    const text = (m.text || '').replace(/<@(U[A-Z0-9]+)>/g, (_, id: string) => {
      const u = users.get(id);
      return `@${u ? u.profile?.display_name || u.name || id : id}`;
    });
    lines.push(`${chalk.cyan(when)}  ${chalk.bold(name)}`);
    lines.push(`  ${text}`);
    if (m.reactions && m.reactions.length > 0) {
      lines.push('  ' + chalk.yellow(formatReactions(m.reactions)));
    }
    if (m.reply_count) lines.push(chalk.dim(`  ↳ ${m.reply_count} replies (ts=${m.ts})`));
    lines.push('');
  }
  return lines.join('\n');
}

export function formatReactions(reactions: SlackReaction[]): string {
  return reactions.map((r) => `:${r.name}: ${r.count}`).join('  ');
}
