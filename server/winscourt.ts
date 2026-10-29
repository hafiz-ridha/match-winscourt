/**
 * Integrasi Wins Court: hanya login penyewa (nama + no. HP) dan jam main booking.
 *
 * Mode asli: set WINSCOURT_API_URL (mis. https://wins-court.com/api/v1/booking-login.php) dan WINSCOURT_API_KEY.
 * Endpoint menerima POST {nama, no_hp} dan mengembalikan
 *   [{booking_id, olahraga, lapangan[], tanggal, jam_mulai, jam_selesai}]
 * Tanpa env tersebut, server memakai data booking contoh (mock).
 */
import type { Booking, Sport } from '../shared/types.ts';
import { normalizeName, normalizePhone } from '../shared/util.ts';

const API_URL = process.env.WINSCOURT_API_URL;
const API_KEY = process.env.WINSCOURT_API_KEY ?? '';

export const isMock = !API_URL;

interface RemoteBooking {
  booking_id: string | number;
  olahraga: string;
  lapangan: number[];
  tanggal: string;
  jam_mulai: string;
  jam_selesai: string;
}

/** Tanggal + jam WIB → ISO dengan offset +07:00. */
const wib = (date: string, time: string) => `${date}T${time.length === 5 ? time + ':00' : time}+07:00`;

function wibDate(offsetDays: number): string {
  const d = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Jam WIB sekarang dibulatkan ke bawah ke jam penuh, digeser `deltaH` jam. */
function hourFromNow(deltaH: number): string {
  const now = new Date(Date.now() + 7 * 3600_000);
  now.setUTCMinutes(0, 0, 0);
  const t = new Date(now.getTime() + deltaH * 3600_000);
  return `${t.toISOString().slice(0, 13)}:00:00+07:00`;
}

/** Data contoh dibuat relatif terhadap waktu sekarang agar selalu bisa dicoba. */
function mockBookings(): Booking[] {
  return [
    { id: 'WC-1001', name: 'Budi Santoso', phone: '6281234567890', sport: 'badminton', courts: [3, 4], start: hourFromNow(0), end: hourFromNow(2) },
    { id: 'WC-1002', name: 'Budi Santoso', phone: '6281234567890', sport: 'padel', courts: [1], start: wib(wibDate(1), '19:00'), end: wib(wibDate(1), '21:00') },
    { id: 'WC-1003', name: 'Sari Dewi', phone: '6285600001111', sport: 'padel', courts: [1], start: hourFromNow(0), end: hourFromNow(2) },
    { id: 'WC-1004', name: 'Sari Dewi', phone: '6285600001111', sport: 'badminton', courts: [1, 2, 3, 4], start: wib(wibDate(3), '20:00'), end: wib(wibDate(3), '23:00') },
    { id: 'WC-1005', name: 'Happyminton', phone: '6281999888777', sport: 'badminton', courts: [1, 2, 3], start: hourFromNow(-1), end: hourFromNow(0) },
  ];
}

export const MOCK_ACCOUNTS = [
  { name: 'Budi Santoso', phone: '081234567890', note: 'Badminton Line 3 & 4, sekarang' },
  { name: 'Sari Dewi', phone: '085600001111', note: 'Padel, sekarang' },
  { name: 'Happyminton', phone: '081999888777', note: 'Badminton Line 1–3, jam main baru habis' },
];

const nameMatches = (input: string, booked: string) => {
  const a = normalizeName(input);
  const b = normalizeName(booked);
  return a === b || b.startsWith(a + ' ') || a.startsWith(b + ' ');
};

const clampCourts = (sport: Sport, courts: number[]) => (sport === 'padel' ? [1] : courts.filter((c) => c >= 1 && c <= 4).slice(0, 4));

/** Cari booking milik penyewa untuk hari ini s.d. 7 hari ke depan (plus yang selesai < 12 jam lalu). */
export async function findBookings(name: string, phone: string): Promise<Booking[]> {
  const p = normalizePhone(phone);
  let list: Booking[];
  if (API_URL) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ nama: name, no_hp: p }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Wins Court API ${res.status}`);
    const rows = (await res.json()) as RemoteBooking[];
    list = rows.map((r) => {
      const sport: Sport = /padel/i.test(r.olahraga) ? 'padel' : 'badminton';
      return {
        id: String(r.booking_id),
        name,
        phone: p,
        sport,
        courts: clampCourts(sport, r.lapangan),
        start: wib(r.tanggal, r.jam_mulai),
        end: r.jam_selesai === '24:00' ? wib(r.tanggal, '23:59:59') : wib(r.tanggal, r.jam_selesai),
      };
    });
  } else {
    list = mockBookings().filter((b) => b.phone === p && nameMatches(name, b.name));
  }
  const now = Date.now();
  return list
    .filter((b) => new Date(b.end).getTime() > now - 12 * 3600_000 && new Date(b.start).getTime() < now + 8 * 86_400_000)
    .sort((x, y) => x.start.localeCompare(y.start));
}
