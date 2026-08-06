# Mac Mini Remote Control

A local control panel for the remote coding rig — a single dashboard for the
sessions, tunnels, dev servers, and agent browser running on the always-on Mac
mini (the `coding-setup` rig). It runs **on your laptop** and drives the rig by
shelling out to the same `ssh` / `tmux` / `cmux` commands you'd type by hand.

> Runs locally at **http://localhost:4321** and is available inside the tailnet
> through Tailscale Serve. The app itself stays bound to loopback.

## What it does

- **Live status** (polls every 4s, plus a manual refresh): tmux sessions, CPU,
  memory, disk, uptime, macOS version, screen sharing, and dev servers on the
  mini. The slower macOS update check is cached for 30 minutes.
- **Sessions** — open any session in a **new cmux workspace** (attach), start a
  **repo-aware new session**, **rename**, or **kill** it and every process still
  attached to its panes (with confirmation).
- **New session** — browse a **directory tree under `~`** and launch there.
  The name comes from an explicit name you type, or, if blank, from **local
  gemma** (ollama) using an optional task description, falling back to the
  directory name. The `cc-`/`cx-`/`sh-` prefix encodes the agent type.
- **Screen share** — see the VNC tunnel state and open it with one click.
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
  `automation.socketControlMode` to `"password"` and set a socket password in
  cmux Settings. The CLI reads that saved password automatically. The panel also
  launches cmux and waits for its automation socket when needed.
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
- Publishes the dashboard to this Mac's tailnet-only
  `http://<macbook-name>.<tailnet>.ts.net` address. The installer prints the
  exact URL; open it on a phone connected to the same tailnet. Traffic remains
  encrypted by Tailscale.
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
| `RIG_CODE_ROOT` | `~` | directory picker root on the mini (dir navigator + `-C` launches) |
| `RIG_CDP_PORT` | `9335` | mini headed-Chrome remote-debugging port |
| `RIG_CMUX_BIN` | `/Applications/cmux.app/Contents/Resources/bin/cmux` | cmux CLI |
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
  Dashboard.tsx       # polling + status panels + per-row actions
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
  (and dir paths can't escape the configured picker root via `..`) before any value reaches a shell.
- **CSRF/origin guard** (`proxy.ts`) — state-changing requests must be same-origin,
  so a malicious browser tab can't drive the rig.
- **Loopback-only bind** (`-H 127.0.0.1`) — Tailscale Serve is the only network
  entry point, so tailnet access controls apply and the ordinary LAN cannot
  reach the app.
- No secrets in the repo — only the SSH alias; the Tailnet host stays in `~/.ssh/config`.
