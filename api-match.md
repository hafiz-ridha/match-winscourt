# API Wins Court untuk match.wins-court.com

match.wins-court.com hanya butuh **1 endpoint** di aplikasi Wins Court (PHP):
cek **nama + no. HP penyewa** dan kembalikan **jam main booking**-nya. Tidak ada data lain yang diambil
(harga, status bayar, penyewa lain).

- Endpoint: `POST https://wins-court.com/api/v1/booking-login.php`
- Dipanggil **hanya dari server** match.wins-court.com (bukan dari browser), dengan header `x-api-key`.

---

## 1. Perintah untuk Claude Code (jalankan di folder project wins-court.com)

Salin seluruh blok ini ke Claude Code / developer yang memegang kode wins-court.com:

```text
Buat endpoint API baru untuk integrasi match.wins-court.com. Ikuti kontrak di bawah persis.

LOKASI
- File baru: api/v1/booking-login.php (sejajar dengan api/jadwal.php dan api/harga.php yang sudah ada).
- Pakai koneksi database yang sama dengan api/jadwal.php (include file konfigurasi/koneksi yang sudah ada,
  jangan menulis ulang kredensial database).
- Pelajari dulu api/jadwal.php untuk tahu nama tabel & kolom booking (nama penyewa, no. HP, tanggal,
  jam, lapangan, jenis lapangan badminton/padel, status/pembatalan, id pesanan).

REQUEST
- Method: POST, Content-Type: application/json
- Header wajib: x-api-key: <MATCH_API_KEY>  (bandingkan dengan hash_equals; simpan key di config server,
  BUKAN di repo). Key salah/kosong → 401 {"error":"unauthorized"}.
- Body: {"nama": "Budi Santoso", "no_hp": "6281234567890"}
- Method selain POST → 405. Body tidak valid → 400.

PENCOCOKAN
- Normalisasi no. HP di kedua sisi: buang semua selain angka; awalan "0" → "62"; awalan "8" → "628...";
  "+62"/"62" tetap "62". Bandingkan hasil normalisasi.
- Nama: cocok jika (huruf kecil, spasi dirapikan) sama persis, ATAU salah satu diawali yang lain + spasi
  (contoh "budi" cocok dengan "Budi Santoso"). No. HP adalah kunci utama; nama pengecekan kedua.
- Ambil booking milik no. HP itu dengan tanggal dari KEMARIN s.d. 7 HARI ke depan (zona Asia/Jakarta).
- Abaikan booking yang dibatalkan. Sertakan semua status bayar (Lunas, DP, Belum bayar) dan semua jenis
  (Insidentil, Member Bulanan, Pesanan Khusus, Booking via AYO). Jadwal Coaching tidak perlu disertakan.

PENGGABUNGAN SLOT
- Grid jadwal Wins Court per jam per lapangan. Gabungkan slot milik penyewa yang sama, tanggal sama,
  olahraga sama, dan jamnya bersambung/tumpang tindih menjadi SATU booking:
  lapangan = gabungan nomor lapangan (urut naik), jam_mulai = paling awal, jam_selesai = paling akhir.
- booking_id harus STABIL antar panggilan: pakai id pesanan/checkout jika ada; jika tidak ada,
  gunakan "WC-{tanggal}-{olahraga}-{id slot pertama}".

RESPONSE 200 (array, kosong [] jika tidak cocok — jangan bedakan "nama salah" vs "HP salah")
[
  {
    "booking_id": "WC-1001",
    "olahraga": "badminton",        // "badminton" atau "padel" (huruf kecil)
    "lapangan": [3, 4],             // badminton 1–4 (nomor Line di grid), padel selalu [1]
    "tanggal": "2026-10-29",        // YYYY-MM-DD, WIB
    "jam_mulai": "19:00",           // HH:MM, WIB
    "jam_selesai": "21:00"          // HH:MM, boleh "24:00" untuk slot terakhir
  }
]

KEAMANAN & PRIVASI
- Rate limit sederhana: maks 30 request/menit per IP (simpan hitungan di tabel/APCu/file).
- Jangan pernah mengembalikan nama penyewa lain, no. HP, harga, atau status bayar.
- Header: Content-Type: application/json; Cache-Control: no-store.
- Catat error ke log server, kembalikan {"error":"server"} dengan 500 tanpa detail SQL.

TERAKHIR
- Tambahkan MATCH_API_KEY ke konfigurasi server (contoh: generate dengan `openssl rand -hex 32`).
- Rekomendasi terpisah: api/jadwal.php saat ini mengirim nama penyewa ke publik; ganti nama menjadi
  "Terisi" untuk pengunjung yang bukan admin.
- Uji dengan perintah curl di bagian 3 dokumen api-match.md.
```

---

## 2. Contoh implementasi PHP (sesuaikan nama tabel/kolom)

Kode ini bisa dipakai langsung bila struktur tabelnya mirip; ubah bagian **KONFIGURASI** sesuai database
Wins Court. Butuh PHP 7.4+ dengan PDO.

```php
<?php
// api/v1/booking-login.php — dipanggil server match.wins-court.com
declare(strict_types=1);
date_default_timezone_set('Asia/Jakarta');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ===================== KONFIGURASI ===================== */
require_once __DIR__ . '/../../config.php';            // file koneksi yang sudah dipakai api/jadwal.php
$pdo         = $pdo ?? db();                            // sesuaikan: objek PDO dari config.php
$MATCH_KEY   = getenv('MATCH_API_KEY') ?: (defined('MATCH_API_KEY') ? MATCH_API_KEY : '');
$T           = 'booking';                               // nama tabel slot booking
$C = [                                                   // nama kolom di tabel tsb
  'id'       => 'id',
  'order_id' => 'order_id',          // id pesanan/checkout (boleh null) — isi '' jika tidak ada
  'nama'     => 'nama_penyewa',
  'hp'       => 'no_hp',
  'tanggal'  => 'tanggal',           // DATE
  'mulai'    => 'jam_mulai',         // TIME / 'HH:MM'
  'selesai'  => 'jam_selesai',       // TIME / 'HH:MM'
  'lapangan' => 'lapangan',          // contoh nilai: 'BADMINTON 3' / 'PADEL' / angka
  'jenis'    => 'jenis_booking',     // contoh: 'Jadwal Coaching'
  'batal'    => 'status',            // contoh: 'batal'
];
/* ======================================================= */

function out(int $code, $body): void { http_response_code($code); echo json_encode($body); exit; }
function norm_hp(string $s): string {
  $d = preg_replace('/\D+/', '', $s) ?? '';
  if (strpos($d, '0') === 0) $d = '62' . substr($d, 1);
  elseif (strpos($d, '8') === 0) $d = '62' . $d;
  return $d;
}
function norm_nama(string $s): string { return trim(preg_replace('/\s+/', ' ', mb_strtolower($s)) ?? ''); }
function nama_cocok(string $a, string $b): bool {
  $a = norm_nama($a); $b = norm_nama($b);
  return $a !== '' && ($a === $b || strpos($b, $a . ' ') === 0 || strpos($a, $b . ' ') === 0);
}
function hhmm(string $t): string { return substr($t, 0, 5); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(405, ['error' => 'method']);
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($MATCH_KEY === '' || !hash_equals($MATCH_KEY, $key)) out(401, ['error' => 'unauthorized']);

// Rate limit 30/menit per IP (file sementara).
$ip = $_SERVER['REMOTE_ADDR'] ?? 'x';
$rl = sys_get_temp_dir() . '/match_rl_' . md5($ip . date('YmdHi'));
$n  = (int) @file_get_contents($rl) + 1; @file_put_contents($rl, (string) $n);
if ($n > 30) out(429, ['error' => 'rate_limited']);

$in = json_decode(file_get_contents('php://input') ?: '', true);
$nama = is_array($in) ? trim((string) ($in['nama'] ?? '')) : '';
$hp   = is_array($in) ? norm_hp((string) ($in['no_hp'] ?? '')) : '';
if ($nama === '' || strlen($hp) < 9) out(400, ['error' => 'bad_request']);

try {
  $dari   = date('Y-m-d', strtotime('-1 day'));
  $sampai = date('Y-m-d', strtotime('+7 day'));
  $sql = "SELECT * FROM `$T` WHERE `{$C['tanggal']}` BETWEEN :dari AND :sampai";
  $st = $pdo->prepare($sql);
  $st->execute([':dari' => $dari, ':sampai' => $sampai]);

  $slots = [];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    if (norm_hp((string) $r[$C['hp']]) !== $hp) continue;
    if (!nama_cocok($nama, (string) $r[$C['nama']])) continue;
    if (stripos((string) ($r[$C['batal']] ?? ''), 'batal') !== false) continue;
    if (stripos((string) ($r[$C['jenis']] ?? ''), 'coaching') !== false) continue;
    $lap = strtolower((string) $r[$C['lapangan']]);
    $olahraga = strpos($lap, 'padel') !== false ? 'padel' : 'badminton';
    preg_match('/(\d+)/', $lap, $m);
    $no = $olahraga === 'padel' ? 1 : (int) ($m[1] ?? 0);
    if ($olahraga === 'badminton' && ($no < 1 || $no > 4)) continue;
    $slots[] = [
      'id' => (string) $r[$C['id']],
      'order' => $C['order_id'] !== '' ? (string) ($r[$C['order_id']] ?? '') : '',
      'olahraga' => $olahraga, 'lapangan' => $no,
      'tanggal' => (string) $r[$C['tanggal']],
      'mulai' => hhmm((string) $r[$C['mulai']]), 'selesai' => hhmm((string) $r[$C['selesai']]),
    ];
  }

  // Gabungkan slot bersambung (tanggal & olahraga sama) menjadi satu booking.
  usort($slots, fn($a, $b) => [$a['tanggal'], $a['olahraga'], $a['mulai']] <=> [$b['tanggal'], $b['olahraga'], $b['mulai']]);
  $hasil = [];
  foreach ($slots as $s) {
    $last = &$hasil[count($hasil) - 1];
    if ($hasil && $last['tanggal'] === $s['tanggal'] && $last['olahraga'] === $s['olahraga'] && $s['mulai'] <= $last['jam_selesai']) {
      $last['lapangan'][] = $s['lapangan'];
      if ($s['selesai'] > $last['jam_selesai']) $last['jam_selesai'] = $s['selesai'];
    } else {
      $hasil[] = [
        'booking_id' => $s['order'] !== '' ? 'WC-' . $s['order'] : "WC-{$s['tanggal']}-{$s['olahraga']}-{$s['id']}",
        'olahraga' => $s['olahraga'], 'lapangan' => [$s['lapangan']],
        'tanggal' => $s['tanggal'], 'jam_mulai' => $s['mulai'], 'jam_selesai' => $s['selesai'],
      ];
    }
    unset($last);
  }
  foreach ($hasil as &$h) { $h['lapangan'] = array_values(array_unique($h['lapangan'])); sort($h['lapangan']); }
  out(200, $hasil);
} catch (Throwable $e) {
  error_log('[booking-login] ' . $e->getMessage());
  out(500, ['error' => 'server']);
}
```

> Jika satu jam yang sama di-booking di dua lapangan (mis. Badminton 3 & 4 pukul 19–21), hasilnya satu
> booking `lapangan: [3, 4]`. Slot yang tidak bersambung (19–20 lalu 22–23) menjadi dua booking.

---

## 3. Uji endpoint

```bash
# Ganti KEY dan data dengan booking nyata yang ada di jadwal.
curl -s -X POST https://wins-court.com/api/v1/booking-login.php \
  -H 'content-type: application/json' \
  -H 'x-api-key: KEY_RAHASIA' \
  -d '{"nama":"Budi Santoso","no_hp":"081234567890"}'
```

| Uji | Harapan |
| --- | --- |
| Nama + HP benar | `200` berisi array booking |
| HP benar, nama salah | `200` dengan `[]` |
| Tanpa / salah `x-api-key` | `401` |
| Method GET | `405` |
| > 30 request/menit | `429` |

---

## 4. Sambungkan ke match.wins-court.com

Di server aaPanel (folder project match):

```bash
nano .env
```

Isi:

```env
WINSCOURT_API_URL=https://wins-court.com/api/v1/booking-login.php
WINSCOURT_API_KEY=KEY_RAHASIA_YANG_SAMA
```

Lalu terapkan:

```bash
bash install.sh
```

Setelah terhubung, akun demo (Budi, Sari, Happyminton) tidak dipakai lagi; host login dengan nama + no. HP
dari booking asli. match.wins-court.com memanggil endpoint ini saat host login, membuka beranda, membuat
sesi, dan setiap 5 menit untuk menyinkronkan jam main serta nomor Line.
