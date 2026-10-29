# API Wins Court untuk match.wins-court.com (CodeIgniter 3 + HMVC)

match.wins-court.com hanya butuh **1 endpoint** di aplikasi lapangan Wins Court:
cek **nama + no. HP penyewa** dan kembalikan **jam main booking**-nya. Tidak ada data lain yang diambil
(harga, status bayar, penyewa lain).

- Endpoint: `POST https://wins-court.com/api/v1/booking-login`
- Dipanggil **hanya dari server** match.wins-court.com (bukan dari browser), dengan header `x-api-key`.
- Stack aplikasi lapangan: **CodeIgniter 3 + HMVC** (wiredesignz Modular Extensions, `application/modules/…`).

---

## 1. Perintah untuk Claude Code (jalankan di root project aplikasi lapangan Wins Court)

Salin seluruh blok ini ke Claude Code / developer yang memegang kode CI3 Wins Court:

```text
Tambahkan endpoint API untuk integrasi match.wins-court.com di aplikasi CodeIgniter 3 + HMVC ini.
Ikuti kontrak di bawah persis dan ikuti konvensi kode yang SUDAH ADA di project.

0. PELAJARI DULU (jangan langsung menulis kode)
   - Struktur HMVC: application/modules/*/{controllers,models,config,views}.
   - Temukan module/model yang menangani booking & jadwal lapangan (yang dipakai halaman jadwal /
     endpoint api/jadwal yang sudah ada). Catat nama tabel & kolom: id slot, id pesanan/checkout,
     nama penyewa, no. HP, tanggal, jam mulai, jam selesai, lapangan (Badminton 1–4 / Padel),
     jenis booking (Member Bulanan, Coaching, Pesanan Khusus, AYO, Insidentil), status batal.
   - Cek base controller yang dipakai API lain (MX_Controller / MY_Controller / REST_Controller),
     application/config/config.php (url_suffix, csrf_protection, csrf_exclude_uris),
     application/config/routes.php, dan cara project menyimpan secret (.env / config / constants).
   - Jika model booking yang ada sudah punya method pencarian jadwal, PAKAI ULANG; jangan duplikasi query.

1. BUAT MODULE BARU: application/modules/match_api/
   - controllers/Booking_login.php   → class Booking_login extends MX_Controller (atau base API yang
                                        dipakai project), method index() hanya menerima POST.
   - models/Booking_login_model.php  → query booking via $this->db (Query Builder), tanpa SQL mentah
                                        dari input user.
   - config/match_api.php             → $config['match_api_key'] dibaca dari environment/secret project.
   - (opsional) config/routes.php di module jika project memakai routing per module.

2. ROUTING & CSRF
   - application/config/routes.php: $route['api/v1/booking-login'] = 'match_api/booking_login/index';
   - Jika csrf_protection = TRUE: tambahkan 'api/v1/booking-login' ke $config['csrf_exclude_uris'].
   - Jika url_suffix diisi (mis. '.html'/'.php'), pastikan route tetap bisa diakses tanpa suffix,
     atau laporkan URL final yang harus dipakai match.wins-court.com.

3. REQUEST
   - POST, Content-Type: application/json. Baca body dengan $this->input->raw_input_stream.
   - Header wajib x-api-key: bandingkan dengan hash_equals() terhadap config match_api_key.
     Key kosong/salah → 401 {"error":"unauthorized"}.
   - Body: {"nama": "Budi Santoso", "no_hp": "6281234567890"}. Tidak valid → 400. Selain POST → 405.

4. PENCOCOKAN
   - Normalisasi no. HP di kedua sisi: buang selain angka; awalan "0" → "62"; awalan "8" → "628…".
   - Nama cocok jika (huruf kecil, spasi dirapikan) sama, ATAU salah satu diawali yang lain + spasi
     ("budi" cocok "Budi Santoso"). No. HP kunci utama; nama pengecekan kedua.
   - Rentang tanggal: KEMARIN s.d. 7 HARI ke depan, zona Asia/Jakarta.
   - Abaikan booking batal dan Jadwal Coaching. Sertakan semua status bayar & jenis lainnya.
   - Filter no. HP sebisa mungkin di query (kolom HP dinormalisasi atau LIKE akhiran 9 digit),
     lalu cocokkan ulang hasil normalisasi di PHP.

5. PENGGABUNGAN SLOT
   - Slot per jam per lapangan milik penyewa yang sama, tanggal & olahraga sama, jam bersambung/
     tumpang tindih → SATU booking: lapangan = gabungan nomor (urut naik), jam_mulai paling awal,
     jam_selesai paling akhir.
   - booking_id STABIL antar panggilan: pakai id pesanan/checkout jika ada ("WC-{order_id}");
     jika tidak ada: "WC-{tanggal}-{olahraga}-{id slot pertama}".

6. RESPONSE 200 — array, [] jika tidak cocok (jangan bedakan nama salah vs HP salah)
   [
     {
       "booking_id": "WC-1001",
       "olahraga": "badminton",      // "badminton" | "padel"
       "lapangan": [3, 4],           // badminton 1–4 (nomor Line), padel selalu [1]
       "tanggal": "2026-10-29",      // YYYY-MM-DD (WIB)
       "jam_mulai": "19:00",         // HH:MM (WIB)
       "jam_selesai": "21:00"        // HH:MM, boleh "24:00"
     }
   ]
   Kirim via $this->output->set_status_header(200)->set_content_type('application/json')
   ->set_header('Cache-Control: no-store')->set_output(json_encode($data)).

7. KEAMANAN
   - Rate limit 30 request/menit per IP memakai driver cache CI3 (apc → fallback file).
   - Jangan kembalikan nama/HP penyewa, harga, status bayar, atau data penyewa lain.
   - Error tak terduga: log_message('error', …), balas 500 {"error":"server"} tanpa detail SQL.
   - Secret MATCH_API_KEY tidak boleh di-commit; generate: openssl rand -hex 32.

8. SELESAI
   - Uji dengan perintah curl di bagian 3 api-match.md (semua baris tabel uji harus lolos).
   - Laporkan: file yang dibuat/diubah, nama tabel & kolom yang dipakai, URL final endpoint.
   - Rekomendasi terpisah (jangan dikerjakan tanpa persetujuan): endpoint jadwal publik saat ini
     menampilkan nama penyewa; sebaiknya diganti "Terisi" untuk pengunjung non-admin.
```

---

## 2. Contoh implementasi CI3 + HMVC

Struktur file:

```
application/
├── config/
│   ├── config.php            ← tambah 'api/v1/booking-login' ke csrf_exclude_uris (jika CSRF aktif)
│   └── routes.php            ← tambah route
└── modules/
    └── match_api/
        ├── config/
        │   └── match_api.php
        ├── controllers/
        │   └── Booking_login.php
        └── models/
            └── Booking_login_model.php
```

### `application/config/routes.php` (tambahkan)

```php
$route['api/v1/booking-login'] = 'match_api/booking_login/index';
```

### `application/config/config.php` (hanya jika `csrf_protection = TRUE`)

```php
$config['csrf_exclude_uris'] = array_merge(
    isset($config['csrf_exclude_uris']) ? $config['csrf_exclude_uris'] : array(),
    array('api/v1/booking-login')
);
```

### `application/modules/match_api/config/match_api.php`

```php
<?php
defined('BASEPATH') OR exit('No direct script access allowed');

// Secret dibagi dengan match.wins-court.com (WINSCOURT_API_KEY). Jangan di-commit.
$config['match_api_key'] = getenv('MATCH_API_KEY') ?: '';

// Batas request per IP per menit.
$config['match_api_rate_limit'] = 30;
```

### `application/modules/match_api/controllers/Booking_login.php`

```php
<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * POST /api/v1/booking-login
 * Dipanggil server match.wins-court.com: cocokkan nama + no. HP penyewa, kembalikan jam main booking.
 */
class Booking_login extends MX_Controller
{
    public function __construct()
    {
        parent::__construct();
        date_default_timezone_set('Asia/Jakarta');
        $this->config->load('match_api/match_api', TRUE);
        $this->load->model('match_api/Booking_login_model', 'booking_login');
        $this->load->driver('cache', array('adapter' => 'apc', 'backup' => 'file'));
    }

    public function index()
    {
        if ($this->input->method(TRUE) !== 'POST') {
            return $this->json(405, array('error' => 'method'));
        }

        $key      = (string) $this->input->get_request_header('X-Api-Key', TRUE);
        $expected = (string) $this->config->item('match_api_key', 'match_api');
        if ($expected === '' || ! hash_equals($expected, $key)) {
            return $this->json(401, array('error' => 'unauthorized'));
        }

        if ($this->rate_limited()) {
            return $this->json(429, array('error' => 'rate_limited'));
        }

        $in   = json_decode($this->input->raw_input_stream, TRUE);
        $nama = is_array($in) ? trim((string) (isset($in['nama']) ? $in['nama'] : '')) : '';
        $hp   = is_array($in) ? $this->booking_login->norm_hp((string) (isset($in['no_hp']) ? $in['no_hp'] : '')) : '';
        if ($nama === '' || strlen($hp) < 9) {
            return $this->json(400, array('error' => 'bad_request'));
        }

        try {
            $rows = $this->booking_login->cari($nama, $hp,
                date('Y-m-d', strtotime('-1 day')),
                date('Y-m-d', strtotime('+7 day')));
            return $this->json(200, $rows);
        } catch (Throwable $e) {
            log_message('error', '[match_api] ' . $e->getMessage());
            return $this->json(500, array('error' => 'server'));
        }
    }

    private function rate_limited()
    {
        $limit = (int) $this->config->item('match_api_rate_limit', 'match_api');
        $id    = 'match_rl_' . md5($this->input->ip_address() . date('YmdHi'));
        $n     = (int) $this->cache->get($id) + 1;
        $this->cache->save($id, $n, 70);
        return $n > $limit;
    }

    private function json($status, $data)
    {
        $this->output
            ->set_status_header($status)
            ->set_content_type('application/json', 'utf-8')
            ->set_header('Cache-Control: no-store')
            ->set_output(json_encode($data));
    }
}
```

### `application/modules/match_api/models/Booking_login_model.php`

Sesuaikan bagian **PEMETAAN** dengan tabel booking Wins Court (lihat model jadwal yang sudah ada).

```php
<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Booking_login_model extends CI_Model
{
    /* ===================== PEMETAAN (sesuaikan) ===================== */
    private $table = 'booking';
    private $col = array(
        'id'       => 'id',
        'order_id' => 'order_id',      // id pesanan/checkout; '' jika tidak ada
        'nama'     => 'nama_penyewa',
        'hp'       => 'no_hp',
        'tanggal'  => 'tanggal',       // DATE
        'mulai'    => 'jam_mulai',     // TIME / 'HH:MM'
        'selesai'  => 'jam_selesai',   // TIME / 'HH:MM'
        'lapangan' => 'lapangan',      // mis. 'BADMINTON 3' / 'PADEL'
        'jenis'    => 'jenis_booking', // mis. 'Jadwal Coaching'
        'status'   => 'status',        // mis. 'batal'
    );
    /* ================================================================= */

    public function norm_hp($s)
    {
        $d = preg_replace('/\D+/', '', (string) $s);
        if (strpos($d, '0') === 0) {
            $d = '62' . substr($d, 1);
        } elseif (strpos($d, '8') === 0) {
            $d = '62' . $d;
        }
        return $d;
    }

    private function norm_nama($s)
    {
        return trim(preg_replace('/\s+/', ' ', mb_strtolower((string) $s)));
    }

    private function nama_cocok($a, $b)
    {
        $a = $this->norm_nama($a);
        $b = $this->norm_nama($b);
        return $a !== '' && ($a === $b || strpos($b, $a . ' ') === 0 || strpos($a, $b . ' ') === 0);
    }

    /** Booking milik penyewa (nama + HP) dalam rentang tanggal, slot bersambung digabung. */
    public function cari($nama, $hp, $dari, $sampai)
    {
        $c = $this->col;
        // Saring kasar di SQL dengan 9 digit terakhir HP, lalu cocokkan ulang hasil normalisasi di PHP.
        $rows = $this->db
            ->from($this->table)
            ->where($c['tanggal'] . ' >=', $dari)
            ->where($c['tanggal'] . ' <=', $sampai)
            ->like($c['hp'], substr($hp, -9), 'before')
            ->order_by($c['tanggal'] . ' ASC, ' . $c['mulai'] . ' ASC')
            ->get()
            ->result_array();

        $slots = array();
        foreach ($rows as $r) {
            if ($this->norm_hp($r[$c['hp']]) !== $hp) continue;
            if ( ! $this->nama_cocok($nama, $r[$c['nama']])) continue;
            if (stripos((string) $r[$c['status']], 'batal') !== FALSE) continue;
            if (stripos((string) $r[$c['jenis']], 'coaching') !== FALSE) continue;

            $lap      = strtolower((string) $r[$c['lapangan']]);
            $olahraga = strpos($lap, 'padel') !== FALSE ? 'padel' : 'badminton';
            preg_match('/(\d+)/', $lap, $m);
            $no = $olahraga === 'padel' ? 1 : (int) (isset($m[1]) ? $m[1] : 0);
            if ($olahraga === 'badminton' && ($no < 1 || $no > 4)) continue;

            $slots[] = array(
                'id'       => (string) $r[$c['id']],
                'order'    => $c['order_id'] !== '' && isset($r[$c['order_id']]) ? (string) $r[$c['order_id']] : '',
                'olahraga' => $olahraga,
                'lapangan' => $no,
                'tanggal'  => (string) $r[$c['tanggal']],
                'mulai'    => substr((string) $r[$c['mulai']], 0, 5),
                'selesai'  => substr((string) $r[$c['selesai']], 0, 5),
            );
        }
        return $this->gabung($slots);
    }

    /** Slot bersambung (tanggal & olahraga sama) → satu booking dengan gabungan nomor lapangan. */
    private function gabung(array $slots)
    {
        usort($slots, function ($a, $b) {
            return strcmp($a['tanggal'] . $a['olahraga'] . $a['mulai'], $b['tanggal'] . $b['olahraga'] . $b['mulai']);
        });
        $hasil = array();
        foreach ($slots as $s) {
            $i = count($hasil) - 1;
            if ($i >= 0
                && $hasil[$i]['tanggal'] === $s['tanggal']
                && $hasil[$i]['olahraga'] === $s['olahraga']
                && $s['mulai'] <= $hasil[$i]['jam_selesai']) {
                $hasil[$i]['lapangan'][] = $s['lapangan'];
                if ($s['selesai'] > $hasil[$i]['jam_selesai']) {
                    $hasil[$i]['jam_selesai'] = $s['selesai'];
                }
                continue;
            }
            $hasil[] = array(
                'booking_id'  => $s['order'] !== '' ? 'WC-' . $s['order'] : 'WC-' . $s['tanggal'] . '-' . $s['olahraga'] . '-' . $s['id'],
                'olahraga'    => $s['olahraga'],
                'lapangan'    => array($s['lapangan']),
                'tanggal'     => $s['tanggal'],
                'jam_mulai'   => $s['mulai'],
                'jam_selesai' => $s['selesai'],
            );
        }
        foreach ($hasil as &$h) {
            $h['lapangan'] = array_values(array_unique($h['lapangan']));
            sort($h['lapangan']);
        }
        unset($h);
        return $hasil;
    }
}
```

> Satu jam yang sama di dua lapangan (mis. Badminton 3 & 4 pukul 19–21) menjadi satu booking
> `lapangan: [3, 4]`. Slot yang tidak bersambung (19–20 lalu 22–23) menjadi dua booking.
>
> Butuh PHP 7.0+ (memakai `Throwable` dan `hash_equals`). Jika server masih PHP 5.6, ganti
> `catch (Throwable $e)` menjadi `catch (Exception $e)`.

### Menyimpan secret `MATCH_API_KEY`

Pilih yang sesuai dengan cara project menyimpan secret:

- **Environment server (disarankan):** aaPanel → Website → wins-court.com → PHP → atau tambahkan di
  `index.php` / `.htaccess`: `SetEnv MATCH_API_KEY isi_key_rahasia` (Apache) atau
  `fastcgi_param MATCH_API_KEY isi_key_rahasia;` (Nginx).
- **File config yang di-ignore git:** ganti baris `getenv(...)` di `match_api.php` dengan nilai dari file
  secret project yang sudah ada.

---

## 3. Uji endpoint

```bash
# Ganti KEY dan data dengan booking nyata yang ada di jadwal.
curl -s -X POST https://wins-court.com/api/v1/booking-login \
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
| CSRF aktif | tetap `200` (URI sudah dikecualikan), bukan `403` |

---

## 4. Sambungkan ke match.wins-court.com

Di server aaPanel (folder project match):

```bash
nano .env
```

Isi:

```env
WINSCOURT_API_URL=https://wins-court.com/api/v1/booking-login
WINSCOURT_API_KEY=KEY_RAHASIA_YANG_SAMA
```

Lalu terapkan:

```bash
bash install.sh
```

Setelah terhubung, akun demo (Budi, Sari, Happyminton) tidak dipakai lagi; host login dengan nama + no. HP
dari booking asli. match.wins-court.com memanggil endpoint ini saat host login, membuka beranda, membuat
sesi, dan setiap 5 menit untuk menyinkronkan jam main serta nomor Line.
