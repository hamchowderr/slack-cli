import { execFileSync } from 'node:child_process';

const INFISICAL_PROJECT_ID = 'e56e0da5-6460-4bab-bdd6-2fd12ac5447b';
const INFISICAL_PATH = '/slack';
const INFISICAL_KEY = 'SLACK_USER_TOKEN';
const INFISICAL_ENV = 'dev';

export function getToken(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SLACK_USER_TOKEN) return process.env.SLACK_USER_TOKEN;

  try {
    const out = execFileSync(
      'infisical',
      [
        'secrets',
        'get',
        INFISICAL_KEY,
        `--projectId=${INFISICAL_PROJECT_ID}`,
        `--env=${INFISICAL_ENV}`,
        `--path=${INFISICAL_PATH}`,
        '--plain',
        '--silent',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      },
    ).trim();
    if (out.startsWith('xoxp-')) return out;
  } catch {
    // fall through
  }

  throw new Error(
    'No Slack token found. Set SLACK_USER_TOKEN env var, pass --token, or store in Infisical at /slack/SLACK_USER_TOKEN.',
  );
}
