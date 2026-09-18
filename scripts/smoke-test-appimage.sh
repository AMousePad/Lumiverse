#!/usr/bin/env bash

set -euo pipefail

bundle_dir="${1:?usage: smoke-test-appimage.sh <bundle-directory>}"
if [[ ! -d "$bundle_dir" ]]; then
  echo "AppImage bundle directory does not exist: $bundle_dir" >&2
  exit 1
fi

appimages=()
while IFS= read -r -d '' candidate; do
  appimages+=("$candidate")
done < <(find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -print0)

if [[ ${#appimages[@]} -eq 0 ]]; then
  echo "No AppImage found in $bundle_dir" >&2
  exit 1
fi

appimage="${appimages[0]}"
for candidate in "${appimages[@]:1}"; do
  if [[ "$candidate" -nt "$appimage" ]]; then
    appimage="$candidate"
  fi
done
chmod +x "$appimage"

log_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
log_file="$log_root/lumiverse-appimage-smoke.log"

set +e
timeout 15s dbus-run-session -- xvfb-run -a \
  env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage" >"$log_file" 2>&1
status=$?
set -e

# A healthy tray app remains in Tauri's event loop until timeout terminates it.
# Loader, GTK, WebKit and JavaScript bootstrap failures exit before that point.
if [[ $status -ne 124 ]] || ! grep -Fq '[desktop-startup] tray ready' "$log_file"; then
  sed -n '1,240p' "$log_file" >&2
  echo "AppImage did not reach a healthy tray startup (status $status)" >&2
  exit 1
fi

echo "AppImage remained healthy through the 15-second startup smoke test."
