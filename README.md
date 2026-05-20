# slack-cli

Personal Slack CLI for reading DMs, channels, threads, and searching the workspace from the terminal. Pulls token from Infisical by default.

## Bins
- `slk` — primary command (avoids conflict with the Slack desktop app's `slack` binary)
- `slack-cli` — long form

## Setup

Token loading order:
1. `--token <xoxp-...>` flag
2. `SLACK_USER_TOKEN` env var
3. Infisical: project `e56e0da5-6460-4bab-bdd6-2fd12ac5447b` (otaku-internal), env `dev`, path `/slack`, key `SLACK_USER_TOKEN`

## Commands

```bash
slk whoami                      # auth.test
slk dms [-l 100]                # list direct messages
slk groups                      # group DMs (mpim)
slk channels [-a]               # channels you're in (-a = all)
slk users [--include-bots]      # list workspace users
slk read @hamchowderr [-l 30]   # read DM history (by name, @handle, or channel ID)
slk read #general               # read channel history
slk thread <channel> <ts>       # thread replies
slk search "deploy failed"      # search messages
slk send @jane "hey" --yes      # send a DM (--yes required)
slk send "#general" "hey" --yes # send to channel
```

Add `--json` for machine-readable output.

## Build
```bash
npm install
npm run build
npm link
```

## Scopes (user token)
`channels:history channels:read groups:history groups:read im:history im:read mpim:history mpim:read users:read users:read.email search:read chat:write`

App: **Chowderr CLI** in Otaku Solutions workspace.
