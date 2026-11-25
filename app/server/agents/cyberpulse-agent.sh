#!/usr/bin/env bash
# CyberPulse inventory agent for Linux.
#
# Reports what this host runs (OS, kernel, installed packages, running
# container images) to CyberPulse once a day, so vulnerabilities are checked
# against the versions really installed. Read-only: it changes nothing on the
# host except its own config, timer and this script.
#
#   sudo ./cyberpulse-agent.sh install --url https://cyberpulse.example --token cpi_...  [--type server|workstation|laptop]
#   ./cyberpulse-agent.sh print       # show the report that would be sent, send nothing
#   sudo cyberpulse-agent run         # send now (the timer does this daily)
#   sudo cyberpulse-agent uninstall
#
# Needs: bash, curl, coreutils (sha256sum). Outbound HTTPS to the CyberPulse URL only.

set -euo pipefail

AGENT_VERSION="1.0.0"
CONF="/etc/cyberpulse-agent.conf"
BIN="/usr/local/sbin/cyberpulse-agent"

die() { echo "cyberpulse-agent: $*" >&2; exit 1; }
clean() { tr -d '\t\r\n' <<<"${1:-}"; }
line() { local IFS=$'\t'; printf '%s\n' "$*"; }

need_root() { [ "$(id -u)" -eq 0 ] || die "run this as root (sudo)"; }

# ------------------------------------------------------------------ report

collect() {
  local type="${1:-}"
  line "agent" "$AGENT_VERSION"
  line "host" "$(clean "$(hostname 2>/dev/null || cat /etc/hostname)")"
  local fqdn; fqdn="$(hostname -f 2>/dev/null || true)"
  [ -n "$fqdn" ] && line "fqdn" "$(clean "$fqdn")"

  local mid=""
  for f in /etc/machine-id /var/lib/dbus/machine-id; do
    [ -s "$f" ] && { mid="$(cat "$f")"; break; }
  done
  [ -n "$mid" ] || mid="$(hostname)-$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || true)"
  # Only a hash of the machine id leaves the host.
  line "machine" "$(printf '%s' "cyberpulse:$mid" | sha256sum | cut -d' ' -f1)"

  if [ -z "$type" ]; then
    case "$(cat /sys/class/dmi/id/chassis_type 2>/dev/null || echo)" in
      8|9|10|14|31|32) type="laptop" ;;
      *) type="server" ;;
    esac
  fi
  line "type" "$type"

  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    ( . /etc/os-release; line "os" "$(clean "${ID:-}")" "$(clean "${ID_LIKE:-}")" "$(clean "${VERSION_ID:-}")" "$(clean "${PRETTY_NAME:-}")" )
  fi
  line "kernel" "$(uname -r)"
  [ -r /sys/class/dmi/id/sys_vendor ] && line "vendor" "$(clean "$(cat /sys/class/dmi/id/sys_vendor)")"
  [ -r /sys/class/dmi/id/product_name ] && line "model" "$(clean "$(cat /sys/class/dmi/id/product_name)")"

  if command -v ip >/dev/null 2>&1; then
    ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n 16 | while read -r a; do line "ip" "$a"; done
  fi

  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${db:Status-Abbrev}\t${Package}\t${Version}\t${source:Package}\t${source:Version}\n' 2>/dev/null \
      | awk -F'\t' '$1 ~ /^ii/ { printf "pkg\tdpkg\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5 }'
  elif command -v rpm >/dev/null 2>&1; then
    rpm -qa --qf 'pkg\trpm\t%{NAME}\t%{VERSION}-%{RELEASE}\t%{NAME}\t%{VERSION}-%{RELEASE}\n' 2>/dev/null
  elif command -v apk >/dev/null 2>&1; then
    # "openssl-3.3.0-r0 x86_64 {openssl} (Apache-2.0) [installed]"
    apk list -I 2>/dev/null | awk '{
      full=$1; origin=$3; gsub(/[{}]/, "", origin);
      n=split(full, p, "-"); ver=p[n-1] "-" p[n]; name=p[1]; for (i=2; i<=n-2; i++) name=name "-" p[i];
      printf "pkg\tapk\t%s\t%s\t%s\t%s\n", name, ver, origin, ver }'
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker ps --format '{{.Image}}' 2>/dev/null | sort -u | head -n 200 | while read -r img; do
      local label
      label="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$img" 2>/dev/null || true)"
      [ "$label" = "<no value>" ] && label=""
      line "image" "$(clean "$img")" "$(clean "$label")"
    done
  fi
}

# ------------------------------------------------------------------ send

send() {
  [ -r "$CONF" ] || die "not installed: $CONF missing (run install first)"
  # shellcheck disable=SC1090
  . "$CONF"
  [ -n "${CYBERPULSE_URL:-}" ] && [ -n "${CYBERPULSE_TOKEN:-}" ] || die "$CONF needs CYBERPULSE_URL and CYBERPULSE_TOKEN"
  command -v curl >/dev/null 2>&1 || die "curl is required"

  local tmp; tmp="$(mktemp -d)"; chmod 700 "$tmp"
  trap 'rm -rf "$tmp"' RETURN
  collect "${CYBERPULSE_TYPE:-}" > "$tmp/report.txt"
  # The token goes in a header file, never on the command line (ps).
  printf 'Authorization: Bearer %s\n' "$CYBERPULSE_TOKEN" > "$tmp/headers"
  curl -fsS --proto '=https' --tlsv1.2 --max-time 120 --retry 3 --retry-delay 30 \
    -H @"$tmp/headers" -H 'Content-Type: text/plain; charset=utf-8' \
    --data-binary @"$tmp/report.txt" "${CYBERPULSE_URL%/}/api/inventory/report"
  echo
}

# ------------------------------------------------------------------ install

install_agent() {
  need_root
  local url="" token="" type=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --url) url="$2"; shift 2 ;;
      --token) token="$2"; shift 2 ;;
      --type) type="$2"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [[ "$url" =~ ^https:// ]] || die "--url must be the https:// address of CyberPulse"
  [[ "$token" =~ ^cpi_[A-Za-z0-9_-]{40,60}$ ]] || die "--token must be an inventory token (cpi_...)"
  [[ -z "$type" || "$type" =~ ^(server|workstation|laptop)$ ]] || die "--type must be server, workstation or laptop"
  command -v curl >/dev/null 2>&1 || die "curl is required (apt install curl / dnf install curl / apk add curl)"

  install -m 0755 -o root -g root "$0" "$BIN"
  umask 077
  cat > "$CONF" <<EOF
CYBERPULSE_URL='${url%/}'
CYBERPULSE_TOKEN='$token'
CYBERPULSE_TYPE='$type'
EOF
  chmod 600 "$CONF"

  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    cat > /etc/systemd/system/cyberpulse-agent.service <<EOF
[Unit]
Description=CyberPulse inventory agent
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$BIN run
Nice=10
EOF
    cat > /etc/systemd/system/cyberpulse-agent.timer <<EOF
[Unit]
Description=Daily CyberPulse inventory report

[Timer]
OnCalendar=daily
RandomizedDelaySec=2h
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now cyberpulse-agent.timer >/dev/null
    echo "Installed: systemd timer cyberpulse-agent.timer (daily)."
  else
    echo "$((RANDOM % 60)) $((RANDOM % 6 + 1)) * * * root $BIN run >/dev/null 2>&1" > /etc/cron.d/cyberpulse-agent
    chmod 644 /etc/cron.d/cyberpulse-agent
    echo "Installed: /etc/cron.d/cyberpulse-agent (daily)."
  fi
  echo "Sending the first report..."
  send
}

uninstall_agent() {
  need_root
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now cyberpulse-agent.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/cyberpulse-agent.timer /etc/systemd/system/cyberpulse-agent.service
    systemctl daemon-reload || true
  fi
  rm -f /etc/cron.d/cyberpulse-agent "$CONF" "$BIN"
  echo "CyberPulse agent removed. The asset stays in CyberPulse until you delete it there."
}

case "${1:-}" in
  install) shift; install_agent "$@" ;;
  run) send ;;
  print) collect "${2:-}" ;;
  uninstall) uninstall_agent ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
