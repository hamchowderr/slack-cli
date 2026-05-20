/**
 * Convert a user-supplied date string into the string format Slack accepts
 * for `oldest` / `latest` params on `conversations.history`.
 *
 * Accepts:
 *   - A raw Slack UNIX timestamp (with optional fractional part), passed through
 *   - Any string parseable by `new Date(...)` (ISO 8601 like "2026-05-18" or
 *     "2026-05-18T17:00:00Z")
 *
 * Throws on unparseable input.
 */
export function parseSlackDate(input: string): string {
  if (/^\d+(\.\d+)?$/.test(input)) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return (d.getTime() / 1000).toFixed(6);
}
