#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="chikacya/wherever-station"
PLUGIN_SHORT="proxy-console"
requested_version=""
komari_url="${KOMARI_URL:-}"
komari_username="${KOMARI_USERNAME:-}"
assume_yes=false
download_only=false

usage() {
  cat <<'EOF'
Wherever Station guided installer

Usage:
  bash install.sh [--version 0.66.11] [--komari https://monitor.example.com]
                  [--username admin] [--yes] [--download-only]

The password is read silently from the terminal. You may also set
KOMARI_PASSWORD and KOMARI_2FA in a protected environment.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) requested_version="${2:-}"; shift 2 ;;
    --komari) komari_url="${2:-}"; shift 2 ;;
    --username) komari_username="${2:-}"; shift 2 ;;
    --yes) assume_yes=true; shift ;;
    --download-only) download_only=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/wherever-station.XXXXXX")"
cleanup() { rm -rf "$temporary_directory"; }
trap cleanup EXIT

release_api_base="${WHEREVER_RELEASE_API_BASE:-https://api.github.com/repos/${REPOSITORY}/releases}"
release_endpoint="${release_api_base}/latest"
if [[ -n "$requested_version" ]]; then
  requested_version="${requested_version#v}"
  release_endpoint="${release_api_base}/tags/v${requested_version}"
fi

printf '→ Resolving the Wherever Station release…\n'
curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' \
  "$release_endpoint" -o "$temporary_directory/release.json"

python3 - "$temporary_directory/release.json" "$temporary_directory/assets" <<'PY'
import json, pathlib, re, sys
release = json.loads(pathlib.Path(sys.argv[1]).read_text())
assets = release.get("assets") or []
zip_asset = next((item for item in assets if re.fullmatch(r"wherever-station-\d+\.\d+\.\d+\.zip", item.get("name", ""))), None)
sum_asset = next((item for item in assets if item.get("name") == "SHA256SUMS"), None)
if not zip_asset or not sum_asset:
    raise SystemExit("Release is missing the plugin ZIP or SHA256SUMS")
pathlib.Path(sys.argv[2]).write_text(
    release.get("tag_name", "") + "\n" +
    zip_asset["name"] + "\n" + zip_asset["browser_download_url"] + "\n" +
    sum_asset["browser_download_url"] + "\n"
)
PY

release_tag="$(sed -n '1p' "$temporary_directory/assets")"
archive_name="$(sed -n '2p' "$temporary_directory/assets")"
archive_url="$(sed -n '3p' "$temporary_directory/assets")"
checksum_url="$(sed -n '4p' "$temporary_directory/assets")"
archive_path="$temporary_directory/$archive_name"

printf '→ Downloading %s…\n' "$release_tag"
curl -fsSL --retry 3 "$archive_url" -o "$archive_path"
curl -fsSL --retry 3 "$checksum_url" -o "$temporary_directory/SHA256SUMS"

python3 - "$archive_path" "$temporary_directory/SHA256SUMS" <<'PY'
import hashlib, pathlib, sys
archive = pathlib.Path(sys.argv[1])
entries = {}
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
    parts = line.split(maxsplit=1)
    if len(parts) == 2:
        entries[pathlib.Path(parts[1].lstrip("* ")).name] = parts[0].lower()
expected = entries.get(archive.name)
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if not expected or expected != actual:
    raise SystemExit("Checksum verification failed")
print("✓ SHA256 verified")
PY

if $download_only; then
  cp "$archive_path" "./$archive_name"
  printf '✓ Saved %s\n' "$(pwd)/$archive_name"
  exit 0
fi

prompt_value() {
  local variable_name="$1" prompt_text="$2" silent="${3:-false}" value=""
  if [[ ! -r /dev/tty ]]; then
    printf 'Interactive input needs a terminal. Set KOMARI_URL, KOMARI_USERNAME and KOMARI_PASSWORD instead.\n' >&2
    exit 1
  fi
  printf '%s' "$prompt_text" >/dev/tty
  if [[ "$silent" == true ]]; then
    IFS= read -r -s value </dev/tty
    printf '\n' >/dev/tty
  else
    IFS= read -r value </dev/tty
  fi
  printf -v "$variable_name" '%s' "$value"
}

[[ -n "$komari_url" ]] || prompt_value komari_url 'Komari address (HTTPS): '
[[ -n "$komari_username" ]] || prompt_value komari_username 'Komari administrator: '
komari_password="${KOMARI_PASSWORD:-}"
[[ -n "$komari_password" ]] || prompt_value komari_password 'Komari password: ' true
komari_2fa="${KOMARI_2FA:-}"
if ! $assume_yes && [[ -z "$komari_2fa" && -r /dev/tty ]]; then
  prompt_value komari_2fa 'Two-factor code (press Enter if disabled): '
fi

komari_url="${komari_url%/}"
case "$komari_url" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) printf 'Use HTTPS for a remote Komari address.\n' >&2; exit 1 ;;
esac

if ! $assume_yes; then
  printf '\nWherever Station requests node, allowRoutes and allowSystemRPC permissions.\n' >/dev/tty
  prompt_value approval 'Install and approve these permissions? [y/N] '
  [[ "$approval" == "y" || "$approval" == "Y" ]] || { printf 'Cancelled.\n'; exit 0; }
fi

KOMARI_LOGIN_USER="$komari_username" KOMARI_LOGIN_PASSWORD="$komari_password" KOMARI_LOGIN_2FA="$komari_2fa" \
python3 - "$temporary_directory/login.json" <<'PY'
import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "username": os.environ["KOMARI_LOGIN_USER"],
    "password": os.environ["KOMARI_LOGIN_PASSWORD"],
    "2fa_code": os.environ.get("KOMARI_LOGIN_2FA", ""),
}))
PY
chmod 600 "$temporary_directory/login.json"
unset komari_password KOMARI_PASSWORD KOMARI_LOGIN_PASSWORD

printf '→ Signing in to Komari…\n'
http_status="$(curl -sS -o "$temporary_directory/login-response.json" -w '%{http_code}' \
  -c "$temporary_directory/cookies" -b "$temporary_directory/cookies" \
  -H 'Content-Type: application/json' --data-binary "@$temporary_directory/login.json" \
  "$komari_url/api/login")"
[[ "$http_status" =~ ^2 ]] || { printf 'Komari login failed (HTTP %s).\n' "$http_status" >&2; exit 1; }

archive_size="$(wc -c < "$archive_path" | tr -d ' ')"
ARCHIVE_SIZE="$archive_size" ARCHIVE_NAME="$archive_name" python3 - "$temporary_directory/upload-init.json" <<'PY'
import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "purpose": "plugin", "size": int(os.environ["ARCHIVE_SIZE"]), "filename": os.environ["ARCHIVE_NAME"]
}))
PY
http_status="$(curl -sS -o "$temporary_directory/upload-init-response.json" -w '%{http_code}' \
  -c "$temporary_directory/cookies" -b "$temporary_directory/cookies" \
  -H 'Content-Type: application/json' --data-binary "@$temporary_directory/upload-init.json" \
  "$komari_url/api/admin/upload/init")"
[[ "$http_status" =~ ^2 ]] || { printf 'Komari rejected the upload (HTTP %s).\n' "$http_status" >&2; exit 1; }

python3 - "$temporary_directory/upload-init-response.json" "$archive_path" "$temporary_directory/chunks" <<'PY'
import json, pathlib, sys
body = json.loads(pathlib.Path(sys.argv[1]).read_text())
data = body.get("data") or {}
upload_id, chunk_size = data.get("upload_id"), int(data.get("chunk_size") or 0)
if not upload_id or chunk_size < 1:
    raise SystemExit("Komari returned an invalid upload session")
source = pathlib.Path(sys.argv[2]).read_bytes()
directory = pathlib.Path(sys.argv[3]); directory.mkdir()
(directory / "session").write_text(upload_id)
for index, offset in enumerate(range(0, len(source), chunk_size)):
    (directory / f"{index:06d}").write_bytes(source[offset:offset + chunk_size])
PY

upload_id="$(cat "$temporary_directory/chunks/session")"
printf '→ Uploading the plugin…\n'
for chunk in "$temporary_directory/chunks"/[0-9]*; do
  index="$(basename "$chunk")"; index="$((10#$index))"
  http_status="$(curl -sS -o "$temporary_directory/chunk-response.json" -w '%{http_code}' \
    -c "$temporary_directory/cookies" -b "$temporary_directory/cookies" \
    -F "upload_id=$upload_id" -F "chunk_index=$index" \
    -F "chunk_data=@$chunk;type=application/octet-stream;filename=chunk-$index" \
    "$komari_url/api/admin/upload/chunk")"
  [[ "$http_status" =~ ^2 ]] || { printf 'Chunk %s failed (HTTP %s).\n' "$index" "$http_status" >&2; exit 1; }
done

UPLOAD_ID="$upload_id" python3 - "$temporary_directory/upload-merge.json" <<'PY'
import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({"upload_id": os.environ["UPLOAD_ID"]}))
PY
http_status="$(curl -sS -o "$temporary_directory/merge-response.json" -w '%{http_code}' \
  -c "$temporary_directory/cookies" -b "$temporary_directory/cookies" \
  -H 'Content-Type: application/json' --data-binary "@$temporary_directory/upload-merge.json" \
  "$komari_url/api/admin/upload/merge")"
[[ "$http_status" =~ ^2 ]] || { printf 'Plugin installation failed (HTTP %s).\n' "$http_status" >&2; exit 1; }

rpc() {
  local method="$1" params="$2" output="$3"
  RPC_METHOD="$method" RPC_PARAMS="$params" python3 - "$temporary_directory/rpc-request.json" <<'PY'
import json, os, pathlib, sys, time
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "jsonrpc": "2.0", "id": int(time.time() * 1000000),
    "method": os.environ["RPC_METHOD"], "params": json.loads(os.environ["RPC_PARAMS"]),
}))
PY
  local status
  status="$(curl -sS -o "$output" -w '%{http_code}' -c "$temporary_directory/cookies" -b "$temporary_directory/cookies" \
    -H 'Content-Type: application/json' --data-binary "@$temporary_directory/rpc-request.json" "$komari_url/api/rpc2")"
  [[ "$status" =~ ^2 ]] || { printf 'Komari RPC failed (HTTP %s).\n' "$status" >&2; exit 1; }
  python3 - "$output" <<'PY'
import json, pathlib, sys
body = json.loads(pathlib.Path(sys.argv[1]).read_text())
if body.get("error"):
    raise SystemExit("Komari RPC error: " + str(body["error"].get("message", "unknown error")))
PY
}

sleep 1
rpc 'admin:listPlugins' '{}' "$temporary_directory/plugins.json"
plugin_mode="$(PLUGIN_SHORT="$PLUGIN_SHORT" RELEASE_TAG="$release_tag" python3 - "$temporary_directory/plugins.json" <<'PY'
import json, os, pathlib, sys
plugins = json.loads(pathlib.Path(sys.argv[1]).read_text()).get("result") or []
expected = os.environ["RELEASE_TAG"].lstrip("v")
matches = [item for item in plugins if item.get("short") == os.environ["PLUGIN_SHORT"]]
plugin = next((item for item in matches if item.get("version") == expected), None)
if not plugin:
    print("missing")
elif plugin.get("enabled") and plugin.get("running"):
    print("ready")
elif plugin.get("enabled"):
    print("restart")
else:
    print("enable")
PY
)"

[[ "$plugin_mode" != "missing" ]] || { printf 'Installed archive was not found in Komari.\n' >&2; exit 1; }
if [[ "$plugin_mode" == "restart" ]]; then
  rpc 'admin:setPluginEnabled' "{\"short\":\"$PLUGIN_SHORT\",\"enabled\":false}" "$temporary_directory/disable.json"
  plugin_mode="enable"
fi
if [[ "$plugin_mode" == "enable" ]]; then
  rpc 'admin:setPluginEnabled' "{\"short\":\"$PLUGIN_SHORT\",\"enabled\":true}" "$temporary_directory/enable.json"
  requires_approval="$(python3 - "$temporary_directory/enable.json" <<'PY'
import json, pathlib, sys
print("yes" if (json.loads(pathlib.Path(sys.argv[1]).read_text()).get("result") or {}).get("requires_approval") else "no")
PY
)"
  if [[ "$requires_approval" == "yes" ]]; then
    rpc 'admin:setPluginEnabled' "{\"short\":\"$PLUGIN_SHORT\",\"enabled\":true,\"approved\":true}" "$temporary_directory/approve.json"
  fi
fi

sleep 1
rpc 'admin:listPlugins' '{}' "$temporary_directory/plugins-final.json"
PLUGIN_SHORT="$PLUGIN_SHORT" RELEASE_TAG="$release_tag" python3 - "$temporary_directory/plugins-final.json" <<'PY'
import json, os, pathlib, sys
plugins = json.loads(pathlib.Path(sys.argv[1]).read_text()).get("result") or []
expected = os.environ["RELEASE_TAG"].lstrip("v")
plugin = next((item for item in plugins if item.get("short") == os.environ["PLUGIN_SHORT"] and item.get("version") == expected), None)
if not plugin or not plugin.get("enabled") or not plugin.get("running"):
    raise SystemExit("Plugin was uploaded but is not running; inspect Komari plugin management")
print(f"✓ Wherever Station {expected} is installed and running")
PY

printf 'Open Komari → Plugins → Wherever Station. Ciallo～(∠・ω< )⌒★\n'
