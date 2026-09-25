#!/bin/bash
# Dev helper for studio161. Run ./dev.sh help for usage.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
WORKER_DIR="$REPO/worker"
WORKER_URL="https://studio161-settings.ishiboo.workers.dev"
PORT=3161

lan_url() {
  local iface ip
  iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  ip=$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null || echo localhost)
  echo "http://$ip:$PORT"
}

kv() { (cd "$WORKER_DIR" && npx wrangler kv key "$@" --binding SETTINGS --remote); }

cmd="${1:-help}"
shift || true

case "$cmd" in

  web)
    # Hot-reloading UI dev server (vite on :3162). Needs the app running
    # on :3161 for the /api and /ws proxy.
    if ! curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/api/config"; then
      echo "⚠ Nothing on :$PORT — start the backend first (./dev.sh app) or the API/WS proxy will fail."
    fi
    echo "UI dev server: http://localhost:3162"
    exec npm --prefix "$REPO" run dev
    ;;

  app)
    # Build the UI, then run the Tauri app (dev build). Optional arg: wing host.
    (cd "$REPO" && npm run build)
    echo "App will serve: http://localhost:$PORT  and  $(lan_url)"
    exec cargo run --manifest-path "$REPO/Cargo.toml" -- "$@"
    ;;

  build)
    # Full release build: UI + bundled macOS app.
    (cd "$REPO" && npm run build && cargo tauri build)
    echo "Bundle: $REPO/target/release/bundle/macos/Studio161.app"
    ;;

  install)
    # Release build + install to /Applications (replaces any existing copy).
    (cd "$REPO" && npm run build && cargo tauri build)
    ditto "$REPO/target/release/bundle/macos/Studio161.app" /Applications/Studio161.app
    echo "Installed /Applications/Studio161.app"
    ;;

  android)
    # Release APK (signed; keystore in ~/.android/studio161-release.jks),
    # installed to the connected device if one is attached.
    export ANDROID_HOME="$HOME/Library/Android/sdk"
    export NDK_HOME="$ANDROID_HOME/ndk/28.0.12433566"
    (cd "$REPO" && npm run build && cargo tauri android build --apk --target aarch64)
    APK="$REPO/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
    echo "APK: $APK"
    if "$ANDROID_HOME/platform-tools/adb" get-state >/dev/null 2>&1; then
      "$ANDROID_HOME/platform-tools/adb" install -r "$APK"
    else
      echo "(no device connected — skipping install)"
    fi
    ;;

  url)
    lan_url
    ;;

  deploy)
    # Deploy the settings worker to Cloudflare.
    (cd "$WORKER_DIR" && npx wrangler deploy)
    ;;

  tail)
    # Live-tail the worker's logs.
    (cd "$WORKER_DIR" && npx wrangler tail)
    ;;

  creds)
    # Set the worker's USERNAME/PASSWORD secrets (used by the app's sign-in).
    read -rp "Username: " u
    read -rsp "Password: " p; echo
    [ -n "$u" ] && [ -n "$p" ] || { echo "Username and password must be non-empty."; exit 1; }
    (cd "$WORKER_DIR" \
      && printf '%s' "$u" | npx wrangler secret put USERNAME \
      && printf '%s' "$p" | npx wrangler secret put PASSWORD)
    umask 077
    printf '%s:%s' "$u" "$p" > "$WORKER_DIR/.credentials"
    echo "Secrets updated; local copy in worker/.credentials"
    ;;

  keys)
    sub="${1:-list}"
    shift || true
    case "$sub" in
      list)          kv list | jq -r '.[].name' ;;
      get)           out=$(kv get "${1:-config}")
                     echo "$out" | jq . 2>/dev/null || echo "$out" ;;
      delete)        [ $# -ge 1 ] || { echo "usage: ./dev.sh keys delete <key>"; exit 1; }
                     kv delete "$1" ;;
      *)             echo "usage: ./dev.sh keys [list|get [key]|delete <key>]"; exit 1 ;;
    esac
    ;;

  icons)
    # Manage the custom SVG icon library (stored in KV via the worker).
    sub="${1:-list}"
    shift || true
    creds() { cat "$WORKER_DIR/.credentials"; }
    case "$sub" in
      list)
        curl -sf -u "$(creds)" "$WORKER_URL/icons" | jq -r '.[]'
        ;;
      get)
        [ $# -ge 1 ] || { echo "usage: ./dev.sh icons get <name>"; exit 1; }
        curl -sf -u "$(creds)" "$WORKER_URL/icons/$1" || { echo "No such icon."; exit 1; }
        ;;
      put)
        [ $# -ge 1 ] || { echo "usage: ./dev.sh icons put <file.svg> [name]"; exit 1; }
        f="$1"
        [ -f "$f" ] || { echo "No such file: $f"; exit 1; }
        name="${2:-$(basename "$f" .svg | sed -E 's/[^A-Za-z0-9_-]+/-/g; s/^-+|-+$//g')}"
        [ -n "$name" ] || { echo "Cannot derive a name; pass one explicitly."; exit 1; }
        curl -sf -u "$(creds)" -X PUT --data-binary @"$f" "$WORKER_URL/icons/$name" > /dev/null \
          && echo "Uploaded icon '$name' (reference it as custom:$name)"
        ;;
      delete)
        [ $# -ge 1 ] || { echo "usage: ./dev.sh icons delete <name>"; exit 1; }
        curl -sf -u "$(creds)" -X DELETE "$WORKER_URL/icons/$1" > /dev/null && echo "Deleted icon '$1'"
        ;;
      *)
        echo "usage: ./dev.sh icons [list|get <name>|put <file.svg> [name]|delete <name>]"
        exit 1
        ;;
    esac
    ;;

  config)
    # Pretty-print the active cloud config.
    kv get history | jq -r '.states[.active].cfg' | jq .
    ;;

  history)
    # List the cloud undo stack; * marks the active state.
    kv get history | jq -r '.active as $a | .states | to_entries[] | (if .key == $a then "* " else "  " end) + .value.v'
    ;;

  restore)
    # Push an old state from the undo stack as a new save; all devices
    # auto-load it within ~20s. Arg: a timestamp from `history`.
    [ $# -ge 1 ] || { echo "usage: ./dev.sh restore <timestamp-from-history>"; exit 1; }
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    kv get history | jq -r --arg v "$1" '.states[] | select(.v == $v) | .cfg' > "$tmp"
    jq -e . "$tmp" > /dev/null || { echo "No state with that timestamp (see ./dev.sh history)."; exit 1; }
    curl -sf -u "$(cat "$WORKER_DIR/.credentials")" -X PUT --data-binary @"$tmp" "$WORKER_URL/" > /dev/null \
      && echo "Restored. Devices will auto-load it within ~20s."
    ;;

  help|*)
    cat <<EOF
usage: ./dev.sh <command>

  web              hot-reloading UI dev server on :3162 (backend must be running)
  app [winghost]   build UI + run the Tauri app (dev); serves :$PORT on the LAN
  build            release build (UI + bundled Studio161.app)
  install          release build + install to /Applications/Studio161.app
  android          release APK build + install to connected device
  url              print the LAN URL other devices should open

  deploy           deploy the Cloudflare settings worker
  tail             live-tail worker logs
  creds            set the cloud username/password (worker secrets)

  keys list        list all KV keys
  keys get [key]   print a raw KV value (default: config)
  keys delete <k>  delete a KV key
  config           pretty-print the active cloud config
  history          list the cloud undo stack (* = active state)
  restore <ts>     push an old state as a new save (timestamp from history)

  icons list                    list custom SVG icons
  icons get <name>              print an icon's SVG source
  icons put <file.svg> [name]   upload an icon (name defaults to filename)
  icons delete <name>           delete an icon
EOF
    ;;
esac
