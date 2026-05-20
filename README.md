# slack-cli

Personal Slack CLI for reading DMs, channels, threads, searching the workspace,
posting messages, reacting, editing, deleting, file upload, and streaming new
activity — from the terminal. Pulls token from Infisical by default.

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

### Read

```bash
slk whoami                              # auth.test
slk dms [-l 100] [--include-connect]    # list direct messages; --include-connect
                                        # resolves external Slack Connect partners
slk groups                              # group DMs (mpim)
slk channels [-a]                       # channels you're in (-a = all)
slk users [--include-bots] [--include-connect]
                                        # list workspace users; --include-connect
                                        # also walks shared channels via
                                        # conversations.members + users.info to
                                        # surface external Slack Connect users
                                        # (yellow-tinted rows in human output)
slk channel <id>                        # resolve a channel ID to {name, kind, shared?}
slk read @hamchowderr [-l 30]           # read DM history (by name, @handle, or channel ID)
slk read #general                       # read channel history
slk read C0A8A388YUF --since 2026-05-19 --before 2026-05-20 [--all] [--no-resolve]
                                        # date-filter via oldest/latest on
                                        # conversations.history; --all paginates;
                                        # --no-resolve keeps raw <@Uxxx> mentions
slk thread <channel> <ts>               # thread replies
slk search "deploy failed"              # search messages
```

### Write

All mutation commands require `--yes` to skip confirmation (matches `slk send`).

```bash
slk send @jane "hey" --yes              # send a DM
slk send "#general" "hey" --yes
slk send "#general" "follow up" --thread 1779238218.213609 --yes
slk send "#general" "ping channel" --thread <ts> --reply-broadcast --yes
slk send "#general" "ship logs" --attach app.log --attach trace.txt --yes
                                        # uses files.getUploadURLExternal +
                                        # completeUploadExternal (new API)
slk update <target> <ts> "fixed typo" --yes      # chat.update
slk delete <target> <ts> --yes                   # chat.delete
slk react   <target> <ts> :thumbsup:             # reactions.add
slk react-remove <target> <ts> :thumbsup:        # reactions.remove
```

### Stream / export

```bash
slk watch <target> [-i 10] [-l 20] [--once]
                                        # poll for new messages and emit them
                                        # as they arrive; --once = single poll
                                        # (cron-friendly). Ctrl-C exits cleanly.
slk export <target> [--since X] [--before Y] [-o out.txt]
                                        # paginate full history into stdout
                                        # or a file. Use --json globally for
                                        # machine-readable output.
```

Add `--json` for machine-readable output (e.g. when calling slk from other tools).

### Rendering

`slk read` (human output) renders:
- Channel name in the header even when called with a raw `CXXX` / `DXXX` ID (resolved via `conversations.info`)
- Reactions inline below each message: `:taco: 1   :seedling: 2`
- Attached files below each message: `[file: image.png (image/png, 45.3KB)]`
- `@user` mentions resolved to display names (including Connect users when the cache has them); pass `--no-resolve` to keep `<@Uxxx>` raw

`--json` output is the raw `conversations.history` response shape — backward-compatible for any tool already consuming slk JSON.

## Issue tracking

Work on slack-cli is tracked in `beads`. Run `bd ready` from the repo root to see open issues. See [AGENTS.md](./AGENTS.md) for the workflow.

## Tests

```bash
npm run test            # vitest run — pure-function unit tests, no network
npm run typecheck       # tsc --noEmit
```

CI runs `typecheck + build + test` on every push and PR (Node 20.x and 22.x). See `.github/workflows/ci.yml`.

## Build
```bash
npm install
npm run build
npm link
```

## Scopes (user token)
`channels:history channels:read groups:history groups:read im:history im:read mpim:history mpim:read users:read users:read.email search:read chat:write reactions:read reactions:write files:read files:write`

App: **Chowderr CLI** in Otaku Solutions workspace.

## License

MIT — see [LICENSE](./LICENSE).
