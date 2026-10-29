# match.wins-court.com

Matchmaking & skoring **badminton (Line 1–4)** dan **padel (1 lapangan)** untuk penyewa Wins Court. Semua fitur gratis.

- Host login dengan **nama + no. HP penyewa** yang tercatat di booking Wins Court; sesi mengikuti jam main booking (boleh lewat, dengan peringatan).
- Pemain gabung lewat link sesi (pilih nama / masuk dengan PIN / daftar baru), masuk waitlist sampai host menyetujui.
- Badminton: Mabar Bergilir, Americano, Knockout, Grup → Knockout — lapangan yang selesai langsung lanjut tanpa menunggu lapangan lain.
- Padel: Americano, Mexicano, Mix Americano, Mixicano, Team Americano/Mexicano, Pemenang Bertahan, Main dengan Tamu, Club vs Club, Knockout, Grup → Knockout, Custom.
- Skor badminton ala Kourt (rally point, target bebas, selisih 2). Skor padel: poin langsung, game (golden point / advantage / star point), atau game & set.
- Realtime ke semua HP (SSE), lapangan beranimasi dengan pemain & level, papan wasit dengan antrean offline, papan skor lokal, papan TV, peringkat dengan kompensasi +M, ringkasan + bagikan gambar/PDF/CSV.

## Deploy ke aaPanel (Docker)

Butuh server Linux dengan aaPanel dan akses root. Docker dipasang otomatis jika belum ada
(disarankan lewat aaPanel → App Store → Docker).

```bash
cd /www/wwwroot
git clone https://github.com/hafiz-ridha/match-winscourt.git
cd match-winscourt
bash install.sh
```

Installer akan: memeriksa Docker & Compose, membuat `.env`, membangun image, menjalankan container di
`127.0.0.1:8787`, menunggu aplikasi sehat, lalu menampilkan langkah reverse proxy aaPanel:

1. **Website → Add site** `match.wins-court.com` (static).
2. **Reverse proxy** → target `http://127.0.0.1:8787`, matikan cache.
3. Pastikan `proxy_buffering off;` di konfigurasi (contoh: [deploy/aapanel-nginx.conf](deploy/aapanel-nginx.conf)) agar skor live langsung sampai.
4. **SSL** → Let's Encrypt → Force HTTPS.

Perintah lain:

```bash
bash install.sh status    # cek container & kesehatan
bash install.sh logs      # log aplikasi
bash install.sh backup    # salin database ke backups/
git pull && bash install.sh   # update ke versi terbaru
```

Data tersimpan di folder `data/` (ikut backup aaPanel).

## Integrasi Wins Court

Login penyewa memakai 1 endpoint di wins-court.com. Spesifikasi, perintah untuk developer/Claude Code,
contoh PHP, dan cara uji ada di [api-match.md](api-match.md). Setelah endpoint siap, isi `.env`:

```env
WINSCOURT_API_URL=https://wins-court.com/api/v1/booking-login.php
WINSCOURT_API_KEY=...
```

lalu jalankan ulang `bash install.sh`. Tanpa `WINSCOURT_API_URL`, aplikasi berjalan dalam mode demo.

### Akun demo (mode demo)

| Nama | No. HP | Booking |
| --- | --- | --- |
| Budi Santoso | 081234567890 | Badminton Line 3 & 4, mulai jam ini (2 jam) + padel besok |
| Sari Dewi | 085600001111 | Padel, mulai jam ini (2 jam) |
| Happyminton | 081999888777 | Badminton Line 1–3, jam main baru habis (uji peringatan) |

## Pengembangan lokal

Butuh Node.js 22.18+ (menjalankan TypeScript langsung dan SQLite bawaan Node).

```bash
npm install
npm run build
npm start          # http://localhost:8787
```

Hot reload: `npm run dev:server` dan `npm run dev:web` di dua terminal, lalu buka http://localhost:5173.

```bash
npm test           # tes mesin matchmaking & skoring
npm run typecheck
```

| Env | Fungsi | Default |
| --- | --- | --- |
| `PORT` | Port server | `8787` |
| `DB_FILE` | Lokasi database SQLite | `data/match.db` |
| `WINSCOURT_API_URL` | Endpoint login booking Wins Court. Kosong = mode demo | — |
| `WINSCOURT_API_KEY` | API key header `x-api-key` | — |

## Struktur

```
shared/   tipe, format, skoring, mesin matchmaking, peringkat (dipakai server & web)
server/   API Express, SQLite, integrasi Wins Court, aksi sesi
src/      aplikasi React (PWA)
tests/    tes mesin
deploy/   contoh konfigurasi Nginx aaPanel
install.sh, Dockerfile, docker-compose.yml   deploy container
```
