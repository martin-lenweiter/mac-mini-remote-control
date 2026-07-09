# Mission Control

A local control panel for the remote coding rig — a single dashboard for the
sessions, tunnels, dev servers, and agent browser running on the always-on Mac
mini (the `coding-setup` rig). It runs **on your laptop** and drives the rig by
shelling out to the same `ssh` / `tmux` / `cmux` commands you'd type by hand.

> Runs at **http://localhost:4321**. Single-user, local-only — no auth, never
> exposed beyond loopback.

## What it does

- **Live status** (polls every 4s, plus a manual refresh): tmux sessions on the
  mini, active SSH tunnels, dev servers listening on the mini, and the mini's
  headed-Chrome / agent-browser health.
- **Sessions** — open any session in a **new cmux workspace** (attach), start a
  **repo-aware new session**, **rename**, or **kill** (with confirmation).
- **New session** — browse a **directory tree under `~/code`** and launch there.
  The name comes from an explicit name you type, or, if blank, from **local
  gemma** (ollama) using an optional task description, falling back to the
  directory name. The `cc-`/`cx-`/`sh-` prefix encodes the agent type.
- **Screen share** — one-click VNC tunnel into the mini.
- **Dev servers** — forward a mini port to your laptop and open it, or tear the
  forward down.

## How it works

The browser can't open `ssh` tunnels, `vnc://`, or a terminal — those need a
local process. So this is a Next.js app whose **server-side API routes shell out**
on the laptop:

- Reads (status, dir listing) run over `ssh mini …` and are parsed in `lib/rig.ts`.
- Actions run local commands: `cmux workspace create` to open sessions, `ssh -f -N -L …`
  for tunnels, `open vnc://…` for screen share.
- Sessions are launched through the rig's own `cct`/`cxt`/`tmt` launchers (single
  source of truth) using their `-C <dir>` flag, so behavior matches the CLI.

## Requirements

- The **`coding-setup` rig** configured: an SSH alias `mini` in `~/.ssh/config`,
  the `cct`/`cxt`/`tmt` launchers on the mini (with the `-C` flag), and key-based
  SSH over Tailscale.
- **cmux** installed on the laptop (sessions open as cmux workspaces). Because
  the panel runs as a launchd service — *outside* cmux's process tree — cmux's
  default `cmuxOnly` socket policy rejects it. In `~/.config/cmux/cmux.json` set
  `automation.socketControlMode` to `"password"` with an `automation.socketPassword`,
  give Mission Control that same value via `RIG_CMUX_SOCKET_PASSWORD`, and
  **restart cmux once** (the socket auth gate binds at launch; `reload-config`
  does not rebind it).
- **ollama** with a small model (`gemma4:e4b` by default) for session auto-naming
  — optional; naming falls back to the directory name if it's unavailable.
- **bun**.

## Running it

### Always on (recommended)

Installs a `launchd` agent so the panel is always serving at the same URL,
restarting on crash and at login:

```sh
scripts/install-service.sh
```

- Serves the production build at **http://localhost:4321**.
- Logs: `~/Library/Logs/mission-control.log`.
- Stop: `launchctl bootout gui/$(id -u)/io.grace.mission-control`
- **After changing the app code, re-run the script** to rebuild and reload.

### Development

```sh
bun install
bun run dev        # http://localhost:4321 (stop the service first, or it clashes on 4321)
bun run test       # vitest
bun run lint       # biome
bun run build      # production build
```

## Configuration

Defaults match the rig; override via `.env.local` (never commit a real Tailnet
host — the app only needs the SSH alias):

| Var | Default | Purpose |
|-----|---------|---------|
| `RIG_SSH_ALIAS` | `mini` | SSH alias for the mini |
| `RIG_CODE_ROOT` | `~/code` | repo root on the mini (dir navigator + `-C` launches) |
| `RIG_CDP_PORT` | `9335` | mini headed-Chrome remote-debugging port |
| `RIG_CHROME_LABEL` | `io.grace.chrome-local` | launchd label for the mini's Chrome |
| `RIG_CMUX_BIN` | `/Applications/cmux.app/Contents/Resources/bin/cmux` | cmux CLI |
| `RIG_CMUX_SOCKET_PASSWORD` | _(unset)_ | cmux socket password; must match `automation.socketPassword` so the launchd service can drive cmux (see Requirements). Keep in `.env.local`. |
| `RIG_OLLAMA_URL` | `http://localhost:11434` | local ollama endpoint |
| `RIG_NAMER_MODEL` | `gemma4:e4b` | naming model |
| `RIG_NAMER_TIMEOUT_MS` | `12000` | naming timeout before falling back |
| `NEXT_PUBLIC_RIG_LABEL` | `mini` | host label shown in the header |

## Structure

```
app/
  api/            # route handlers (Node runtime) — thin wrappers over lib/rig
  page.tsx        # renders <Dashboard/>
  layout.tsx      # system font, dark theme, toaster
components/
  Dashboard.tsx       # polling + the four panels + per-row actions
  NewSessionDialog.tsx
  ActionButton.tsx, providers.tsx, ui/  # shadcn
lib/
  rig.ts          # command builders + ssh exec + parsers (the core)
  naming.ts       # local gemma slug generation + sanitizer
  config.ts       # rig config (server-only); labels.ts (client-safe)
  types.ts        # shared types
proxy.ts          # CSRF/origin guard for state-changing routes
```

## Security

Local single-user tool with no app auth by design. Defenses that matter for a
process that shells out and runs on `localhost`:

- **Input allowlists** — session names, repo/dir paths, and ports are validated
  (and dir paths can't escape `~/code` via `..`) before any value reaches a shell.
- **CSRF/origin guard** (`proxy.ts`) — state-changing requests must be same-origin,
  so a malicious browser tab can't drive the rig.
- **Loopback-only bind** (`-H 127.0.0.1`) — never exposed to the network.
- No secrets in the repo — only the SSH alias; the Tailnet host stays in `~/.ssh/config`.
