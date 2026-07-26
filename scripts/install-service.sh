#!/usr/bin/env bash
# Install Mac Mini Remote Control as an always-on LaunchAgent so it serves at a stable
# http://localhost:4321 — starts at login, restarts on crash. Idempotent.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun)"
LABEL="io.grace.mission-control"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mission-control.log"
UID_NUM="$(id -u)"

if [ -z "$BUN" ]; then
  echo "error: bun not found on PATH" >&2
  exit 1
fi

echo "Building production bundle…"
(cd "$DIR" && "$BUN" install && "$BUN" run build)

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

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

# Reload cleanly.
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
for attempt in 1 2 3 4 5; do
  if bootstrap_error="$(launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>&1)"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "$bootstrap_error" >&2
    echo "error: launchd did not accept $LABEL after $attempt attempts" >&2
    exit 1
  fi
  sleep 0.25
done
launchctl enable "gui/$UID_NUM/$LABEL"

echo "Installed $LABEL — Mac Mini Remote Control is always on at http://localhost:4321"
echo "Logs: $LOG"
echo "Stop:  launchctl bootout gui/$UID_NUM/$LABEL"
