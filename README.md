# slack-cli

Personal Slack CLI for reading DMs, channels, threads, and searching the workspace from the terminal. Pulls token from Infisical by default.

Repo: https://github.com/hamchowderr/slack-cli

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
slk whoami                              # auth.test
slk dms [-l 100]                        # list direct messages
slk groups                              # group DMs (mpim)
slk channels [-a]                       # channels you're in (-a = all)
slk users [--include-bots] [--include-connect]
                                        # list workspace users; --include-connect
                                        # also walks shared channels via
                                        # conversations.members + users.info to
                                        # surface external Slack Connect users
                                        # (marked is_stranger / different team_id)
slk channel <id>                        # resolve a channel ID to {name, kind, shared?}
slk read @hamchowderr [-l 30]           # read DM history (by name, @handle, or channel ID)
slk read #general                       # read channel history
slk read C0A8A388YUF --since 2026-05-19 --before 2026-05-20 [--all]
                                        # date-filter via oldest/latest on
                                        # conversations.history; --all paginates
                                        # until every matching message is fetched
slk thread <channel> <ts>               # thread replies
slk search "deploy failed"              # search messages
slk send @jane "hey" --yes              # send a DM (--yes required)
slk send "#general" "hey" --yes         # send to channel
```

Add `--json` for machine-readable output (e.g. when calling slk from other tools).

### Rendering

`slk read` (human output) renders:
- Channel name in the header even when called with a raw `CXXX` / `DXXX` ID (resolved via `conversations.info`)
- Reactions inline below each message: `:taco: 1   :seedling: 2`
- Attached files below each message: `[file: image.png (image/png, 45.3KB)]`
- `@user` mentions resolved to display names (including Connect users when the cache has them)

`--json` output is the raw `conversations.history` response shape — backward-compatible for any tool already consuming slk JSON.

## Issue tracking

Work on slack-cli is tracked in `beads`. Run `bd ready` from the repo root to see open issues.

## Build
```bash
npm install
npm run build
npm link
```

## Scopes (user token)
`channels:history channels:read groups:history groups:read im:history im:read mpim:history mpim:read users:read users:read.email search:read chat:write reactions:read files:read`

App: **Chowderr CLI** in Otaku Solutions workspace.
