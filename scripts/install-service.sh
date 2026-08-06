#!/usr/bin/env bash
# Install Mac Mini Remote Control as an always-on LaunchAgent so it serves at a stable
# http://localhost:4321 — starts at login, restarts on crash. Idempotent.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun)"
TAILSCALE="$(command -v tailscale)"
LABEL="io.grace.mission-control"
TERMINAL_LABEL="io.grace.mission-control-terminal"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TERMINAL_PLIST="$HOME/Library/LaunchAgents/$TERMINAL_LABEL.plist"
LOG="$HOME/Library/Logs/mission-control.log"
TERMINAL_LOG="$HOME/Library/Logs/mission-control-terminal.log"
STATE_DIR="$HOME/.local/state/mission-control"
SECRET_FILE="$STATE_DIR/terminal-secret"
UID_NUM="$(id -u)"

if [ -z "$BUN" ]; then
  echo "error: bun not found on PATH" >&2
  exit 1
fi
if [ -z "$TAILSCALE" ]; then
  echo "error: tailscale not found on PATH" >&2
  exit 1
fi

TAILSCALE_HOST="$(
  "$TAILSCALE" status --json |
    "$BUN" -e 'const input = await Bun.stdin.text(); const host = JSON.parse(input).Self?.DNSName; if (!host) process.exit(1); console.log(host.replace(/\.$/, ""));'
)"
if [ -z "$TAILSCALE_HOST" ]; then
  echo "error: could not determine this Mac's Tailscale hostname" >&2
  exit 1
fi

echo "Building production bundle…"
(cd "$DIR" && "$BUN" install && "$BUN" run build)

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [ ! -s "$SECRET_FILE" ]; then
  umask 077
  openssl rand -hex 32 >"$SECRET_FILE"
fi
chmod 600 "$SECRET_FILE"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

cat >"$TERMINAL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$TERMINAL_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>terminal</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>MISSION_CONTROL_TERMINAL_SECRET_FILE</key><string>$SECRET_FILE</string>
    <key>MISSION_CONTROL_TAILSCALE_HOST</key><string>$TAILSCALE_HOST</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$TERMINAL_LOG</string>
  <key>StandardErrorPath</key><string>$TERMINAL_LOG</string>
</dict>
</plist>
EOF

bootstrap_agent() {
  local label="$1"
  local plist="$2"
  local bootstrap_error=""

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if bootstrap_error="$(launchctl bootstrap "gui/$UID_NUM" "$plist" 2>&1)"; then
      launchctl enable "gui/$UID_NUM/$label"
      return
    fi
    if [ "$attempt" -eq 10 ]; then
      echo "$bootstrap_error" >&2
      echo "error: launchd did not accept $label after $attempt attempts" >&2
      exit 1
    fi
    sleep 0.5
  done
}

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/$TERMINAL_LABEL" 2>/dev/null || true
# launchd can briefly reject a plist with EIO while a booted-out process tree is
# still being reaped. Waiting before bootstrap makes repeated installs reliable.
sleep 2
bootstrap_agent "$LABEL" "$PLIST"
bootstrap_agent "$TERMINAL_LABEL" "$TERMINAL_PLIST"

wait_for_url() {
  local url="$1"
  local label="$2"
  for attempt in $(seq 1 40); do
    if curl --fail --silent --max-time 1 "$url" >/dev/null; then
      return
    fi
    sleep 0.25
  done
  echo "error: $label did not become ready at $url" >&2
  exit 1
}

wait_for_url "http://127.0.0.1:4321/" "$LABEL"
wait_for_url "http://127.0.0.1:4322/health" "$TERMINAL_LABEL"

echo "Publishing to the tailnet…"
"$TAILSCALE" serve --bg --yes --http=80 4321
"$TAILSCALE" serve --bg --yes --http=80 --set-path=/terminal http://127.0.0.1:4322/terminal

echo "Installed $LABEL and $TERMINAL_LABEL."
echo "Dashboard: http://localhost:4321"
echo "Phone: http://$TAILSCALE_HOST"
echo "Logs: $LOG and $TERMINAL_LOG"
echo "Stop: launchctl bootout gui/$UID_NUM/$LABEL"
echo "      launchctl bootout gui/$UID_NUM/$TERMINAL_LABEL"
