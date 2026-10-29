#!/usr/bin/env bash
# =============================================================================
#  Installer match.wins-court.com untuk server aaPanel (Docker)
#
#  Pemakaian (sebagai root, dari folder project):
#     bash install.sh            # pasang / perbarui (aman dijalankan ulang)
#     bash install.sh status     # cek container & kesehatan aplikasi
#     bash install.sh logs       # lihat log aplikasi
#     bash install.sh restart    # restart container
#     bash install.sh stop       # hentikan container (data tetap aman)
#     bash install.sh backup     # salin database ke backups/
#
#  Data (database SQLite) disimpan di folder ./data — ikut backup aaPanel.
# =============================================================================
set -Eeuo pipefail

cd "$(dirname "$(readlink -f "$0")")"
APP_DIR="$(pwd)"
CONTAINER="match-winscourt"

c_ok=$'\033[1;32m'; c_warn=$'\033[1;33m'; c_err=$'\033[1;31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%sGAGAL:%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
trap 'die "perintah di baris $LINENO gagal (lihat pesan di atas)."' ERR

need_root() { [ "$(id -u)" -eq 0 ] || die "Jalankan sebagai root, contoh: sudo bash install.sh"; }

# ---------- Docker & Compose ----------
DC=""
ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker belum terpasang."
    warn "Disarankan pasang lewat aaPanel: App Store → Docker. Mencoba memasang otomatis (get.docker.com)…"
    command -v curl >/dev/null 2>&1 || die "curl tidak ada. Pasang curl dulu (apt install curl / yum install curl)."
    curl -fsSL https://get.docker.com | sh || die "Gagal memasang Docker. Pasang lewat aaPanel App Store → Docker, lalu jalankan ulang."
  fi
  if ! docker info >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
    sleep 2
    docker info >/dev/null 2>&1 || die "Layanan Docker tidak berjalan. Cek: systemctl status docker"
  fi
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
  else
    log "Memasang plugin Docker Compose…"
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -y >/dev/null && apt-get install -y docker-compose-plugin >/dev/null || true
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y docker-compose-plugin >/dev/null || true
    elif command -v yum >/dev/null 2>&1; then
      yum install -y docker-compose-plugin >/dev/null || true
    fi
    docker compose version >/dev/null 2>&1 && DC="docker compose" || die "Docker Compose tidak tersedia. Pasang 'docker-compose-plugin' lalu jalankan ulang."
  fi
}

# ---------- Konfigurasi ----------
env_get() {
  local v=""
  v="$(grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r')" || true
  printf '%s' "$v"
}

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    log "File .env dibuat dari .env.example (mode demo: data booking contoh)."
  fi
  # Rapikan baris CRLF jika .env diedit dari Windows.
  sed -i 's/\r$//' .env
  APP_PORT="$(env_get APP_PORT)"; APP_PORT="${APP_PORT:-8787}"
  [[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "APP_PORT di .env harus angka (sekarang: '$APP_PORT')."
}

port_in_use_by_other() {
  local used=""
  if command -v ss >/dev/null 2>&1; then
    used="$(ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${APP_PORT}\$" || true)"
  elif command -v netstat >/dev/null 2>&1; then
    used="$(netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${APP_PORT}\$" || true)"
  fi
  [ -n "$used" ] || return 1
  # Port dipakai container kita sendiri → bukan konflik.
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "^${CONTAINER} .*:${APP_PORT}->" && return 1
  return 0
}

ensure_data_dir() {
  mkdir -p data backups
  # Container berjalan sebagai user 'node' (uid 1000).
  chown -R 1000:1000 data
}

wait_healthy() {
  log "Menunggu aplikasi siap di http://127.0.0.1:${APP_PORT} …"
  for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/api/config" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  $DC logs --tail=60 || true
  die "Aplikasi belum merespons setelah 90 detik. Lihat log di atas."
}

print_next_steps() {
  local mode="DEMO (data booking contoh)"
  [ -n "$(env_get WINSCOURT_API_URL)" ] && mode="TERHUBUNG ke $(env_get WINSCOURT_API_URL)"
  cat <<EOF

${c_ok}✔ match.wins-court.com berjalan${c_off}
   Lokal     : http://127.0.0.1:${APP_PORT}
   Data      : ${APP_DIR}/data   (backup: bash install.sh backup)
   Wins Court: ${mode}

${c_ok}Langkah di aaPanel (sekali saja):${c_off}
 1. Website → Add site → domain: match.wins-court.com
    (PHP: Static / Pure static, tanpa database).
 2. Buka site → Reverse proxy → Add reverse proxy
       Target URL : http://127.0.0.1:${APP_PORT}
       Send domain: \$host
    Simpan, lalu matikan "Cache" pada reverse proxy tersebut.
 3. Klik "Conf" pada reverse proxy, pastikan ada baris:
       proxy_buffering off;
       proxy_read_timeout 3600s;
    (contoh lengkap: deploy/aapanel-nginx.conf) — penting untuk skor live.
 4. SSL → Let's Encrypt → Apply, lalu aktifkan Force HTTPS.
 5. DNS: arahkan A record 'match' ke IP server ini.

${c_dim}Ubah konfigurasi: edit .env lalu jalankan ulang: bash install.sh${c_off}
EOF
}

# ---------- Perintah ----------
cmd_install() {
  need_root
  command -v curl >/dev/null 2>&1 || die "curl tidak ada. Pasang dulu: apt install -y curl  (atau yum install -y curl)"
  [ -f docker-compose.yml ] && [ -f Dockerfile ] || die "Jalankan dari folder project (berisi Dockerfile & docker-compose.yml)."
  ensure_docker
  ensure_env
  if port_in_use_by_other; then
    die "Port ${APP_PORT} sudah dipakai aplikasi lain. Ubah APP_PORT di .env (mis. 8788) lalu jalankan ulang."
  fi
  ensure_data_dir
  log "Membangun image (pertama kali ±2–5 menit)…"
  $DC build --pull
  log "Menjalankan container…"
  $DC up -d --remove-orphans
  wait_healthy
  docker image prune -f >/dev/null 2>&1 || true
  print_next_steps
}

cmd_backup() {
  need_root
  mkdir -p backups
  local f="backups/match-$(date +%Y%m%d-%H%M%S).db"
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    # Salinan konsisten lewat SQLite di dalam container.
    docker exec "$CONTAINER" node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/app/data/match.db').exec(\"VACUUM INTO '/app/data/backup.tmp.db'\")" 2>/dev/null \
      && mv data/backup.tmp.db "$f" \
      || cp data/match.db "$f"
  else
    cp data/match.db "$f"
  fi
  log "Backup tersimpan: $f"
}

case "${1:-install}" in
  install|update) cmd_install ;;
  status)  ensure_docker; ensure_env; $DC ps; curl -fsS "http://127.0.0.1:${APP_PORT}/api/config" >/dev/null && log "Aplikasi sehat." || warn "Aplikasi tidak merespons." ;;
  logs)    ensure_docker; $DC logs -f --tail=200 ;;
  restart) need_root; ensure_docker; ensure_env; $DC restart; wait_healthy; log "Restart selesai." ;;
  stop)    need_root; ensure_docker; $DC down; log "Container dihentikan. Data tetap di ./data" ;;
  backup)  cmd_backup ;;
  *) die "Perintah tidak dikenal: $1 (pakai: install | status | logs | restart | stop | backup)" ;;
esac
