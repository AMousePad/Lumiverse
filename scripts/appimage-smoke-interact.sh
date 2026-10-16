#!/usr/bin/env bash
set -euo pipefail
"$1" &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
window=""
for _ in {1..120}; do
  window="$(xdotool search --onlyvisible --name '^Lumiverse Desktop Smoke$' 2>/dev/null | head -n 1 || true)"
  [[ -n "$window" ]] && break
  kill -0 "$app_pid" 2>/dev/null || { wait "$app_pid"; exit 1; }
  sleep 0.25
done
[[ -n "$window" ]] || { echo 'WebKit interaction window did not appear' >&2; exit 1; }
# Xvfb has no window manager; focus the window directly, without EWMH activation.
xdotool windowfocus --sync "$window"
xdotool mousemove --window "$window" 100 100 click 1
xdotool type --clearmodifiers --delay 40 'lumiverse-smoke'
xdotool mousemove --window "$window" 100 160 click 1
xdotool mousemove --window "$window" 100 300 click --repeat 6 --delay 80 5
wait "$app_pid"
