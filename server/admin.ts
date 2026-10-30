/**
 * Dashboard admin: lihat pengguna & sesi, unduh data (CSV / backup database), reset PIN akun umum.
 * Kredensial dari environment (.env di server) — tidak pernah ditulis di kode:
 *   ADMIN_USER=root
 *   ADMIN_PASSWORD=<rahasia>
 */
import express, { type Request } from 'express';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatInfo, isManualBooking } from '../shared/formats.ts';
import { matchScore, playerStandings } from '../shared/standings.ts';
import { scoreSummary } from '../shared/scoring.ts';
import type { Session } from '../shared/types.ts';
import { HttpError } from './actions.ts';
import { accounts, admin, hostById } from './db.ts';

const ADMIN_USER = (process.env.ADMIN_USER ?? 'root').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const TOKEN_TTL = 12 * 3600_000;

const tokens = new Map<string, number>(); // token → kedaluwarsa
const attempts = new Map<string, { n: number; reset: number }>();

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function requireAdmin(req: Request) {
  if (!ADMIN_PASSWORD) throw new HttpError(503, 'Admin belum diaktifkan: isi ADMIN_PASSWORD di .env server');
  const h = req.get('authorization') ?? '';
  const t = h.startsWith('Admin ') ? h.slice(6) : '';
  const exp = tokens.get(t);
  if (!exp || exp < Date.now()) {
    tokens.delete(t);
    throw new HttpError(401, 'Sesi admin berakhir. Silakan masuk lagi.');
  }
}

const parse = (row: { data: string }) => JSON.parse(row.data) as Session;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const iso = (ms: number | null) => (ms ? new Date(ms + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) : '');
const stamp = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');

function sendCsv(res: express.Response, name: string, rows: unknown[][]) {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${name}-${stamp()}.csv"`);
  res.setHeader('cache-control', 'no-store');
  res.send(csv(rows));
}

export const adminRouter = express.Router();

adminRouter.post('/login', (req, res) => {
  if (!ADMIN_PASSWORD) throw new HttpError(503, 'Admin belum diaktifkan: isi ADMIN_PASSWORD di .env server');
  const ip = req.ip ?? 'x';
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.reset > now && a.n >= 5) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  const user = String(req.body?.user ?? '').trim();
  const pass = String(req.body?.password ?? '');
  if (!safeEqual(user, ADMIN_USER) || !safeEqual(pass, ADMIN_PASSWORD)) {
    attempts.set(ip, !a || a.reset < now ? { n: 1, reset: now + 15 * 60_000 } : { n: a.n + 1, reset: a.reset });
    throw new HttpError(401, 'User atau password admin salah');
  }
  attempts.delete(ip);
  const t = randomBytes(32).toString('hex');
  tokens.set(t, now + TOKEN_TTL);
  res.json({ token: t, expiresAt: now + TOKEN_TTL });
});

adminRouter.post('/logout', (req, res) => {
  const h = req.get('authorization') ?? '';
  tokens.delete(h.startsWith('Admin ') ? h.slice(6) : '');
  res.json({ ok: true });
});

adminRouter.get('/overview', (req, res) => {
  requireAdmin(req);
  const users = admin.users();
  const rows = admin.sessions();
  const hostName = new Map(users.map((u) => [u.id, u.name]));
  const list = rows.map((r) => {
    const s = parse(r);
    return {
      slug: s.slug,
      name: s.name,
      host: hostName.get(s.hostId) ?? s.hostName,
      hostId: s.hostId,
      sport: s.sport,
      format: formatInfo(s.format).name,
      start: s.start,
      end: s.end,
      status: s.status,
      manual: isManualBooking(s.bookingId),
      bookingId: s.bookingId,
      players: s.players.filter((p) => p.status !== 'left').length,
      matches: s.rounds.reduce((n, rd) => n + rd.matches.filter((m) => m.status === 'done').length, 0),
      updatedAt: r.updated_at,
    };
  });
  res.json({
    stats: {
      users: users.length,
      accounts: users.filter((u) => u.type === 'akun_umum').length,
      renters: users.filter((u) => u.type === 'penyewa_wins').length,
      sessions: list.length,
      running: list.filter((s) => s.status === 'running').length,
      finished: list.filter((s) => s.status === 'finished').length,
      manual: list.filter((s) => s.manual).length,
      players: list.reduce((n, s) => n + s.players, 0),
      matches: list.reduce((n, s) => n + s.matches, 0),
    },
    users,
    sessions: list,
  });
});

/** Reset PIN akun umum: PIN baru 6 digit acak, ditampilkan sekali ke admin untuk diberikan ke pengguna. */
adminRouter.post('/users/:id/reset-pin', (req, res) => {
  requireAdmin(req);
  const host = hostById(req.params.id);
  if (!host || !accounts.byHost(host.id)) throw new HttpError(404, 'Akun umum tidak ditemukan');
  let pin = '';
  do pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  while (/^(\d)\1{5}$/.test(pin) || '0123456789012345'.includes(pin) || '9876543210987654'.includes(pin));
  const salt = randomBytes(16).toString('hex');
  admin.setPin(host.id, scryptSync(pin, salt, 32).toString('hex'), salt);
  res.json({ pin, name: host.name });
});

/* ---------------- unduhan ---------------- */

adminRouter.get('/export/users.csv', (req, res) => {
  requireAdmin(req);
  const rows: unknown[][] = [['Nama', 'No. HP', 'Email', 'Tipe', 'Terdaftar (WIB)', 'Akun umum dibuat (WIB)', 'Jumlah sesi', 'Aktivitas terakhir (WIB)']];
  for (const u of admin.users())
    rows.push([u.name, `+${u.phone}`, u.email ?? '', u.type === 'akun_umum' ? 'Akun umum' : 'Penyewa Wins Court', iso(u.created_at), iso(u.account_created_at), u.sessions, iso(u.last_activity)]);
  sendCsv(res, 'pengguna', rows);
});

adminRouter.get('/export/sessions.csv', (req, res) => {
  requireAdmin(req);
  const users = new Map(admin.users().map((u) => [u.id, u]));
  const rows: unknown[][] = [['Sesi', 'Link', 'Host', 'No. HP host', 'Olahraga', 'Format', 'Mulai', 'Selesai', 'Status', 'Jenis', 'Booking', 'Lapangan', 'Pemain', 'Match selesai']];
  for (const r of admin.sessions()) {
    const s = parse(r);
    const h = users.get(s.hostId);
    rows.push([
      s.name, `/s/${s.slug}`, h?.name ?? s.hostName, h ? `+${h.phone}` : '', s.sport, formatInfo(s.format).name,
      s.start.slice(0, 16).replace('T', ' '), s.end.slice(0, 16).replace('T', ' '), s.status,
      isManualBooking(s.bookingId) ? 'Manual (akun umum)' : 'Booking Wins Court', s.bookingId, s.courtNames.join(' / '),
      s.players.filter((p) => p.status !== 'left').length,
      s.rounds.reduce((n, rd) => n + rd.matches.filter((m) => m.status === 'done').length, 0),
    ]);
  }
  sendCsv(res, 'sesi', rows);
});

adminRouter.get('/export/matches.csv', (req, res) => {
  requireAdmin(req);
  const rows: unknown[][] = [['Sesi', 'Tanggal', 'Olahraga', 'Ronde', 'Lapangan', 'Babak', 'Tim A', 'Tim B', 'Skor', 'Pemenang', 'Status']];
  for (const r of admin.sessions()) {
    const s = parse(r);
    const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? '?';
    for (const rd of s.rounds)
      for (const m of rd.matches) {
        const sc = matchScore(s, m);
        rows.push([
          s.name, s.start.slice(0, 10), s.sport, rd.n, s.courtNames[m.court] ?? m.court + 1, m.stage ?? '',
          m.a.map(name).join(' & '), m.b.map(name).join(' & '), scoreSummary(sc, s.rules),
          sc.winner === 'a' ? 'Tim A' : sc.winner === 'b' ? 'Tim B' : sc.winner === 'draw' ? 'Seri' : '',
          m.status === 'done' ? 'Selesai' : m.status === 'live' ? 'Berjalan' : 'Terjadwal',
        ]);
      }
  }
  sendCsv(res, 'pertandingan', rows);
});

adminRouter.get('/export/standings.csv', (req, res) => {
  requireAdmin(req);
  const rows: unknown[][] = [['Sesi', 'Tanggal', 'Olahraga', 'Peringkat', 'Nama', 'Main', 'Menang', 'Seri', 'Kalah', 'Poin', 'Bonus', '+M', 'Total']];
  for (const r of admin.sessions()) {
    const s = parse(r);
    playerStandings(s).forEach((x, i) => rows.push([s.name, s.start.slice(0, 10), s.sport, i + 1, x.name, x.played, x.won, x.draw, x.lost, x.pf, x.bonus, x.comp, x.total]));
  }
  sendCsv(res, 'peringkat', rows);
});

adminRouter.get('/export/database.db', (req, res) => {
  requireAdmin(req);
  const dir = mkdtempSync(join(tmpdir(), 'match-backup-'));
  const file = join(dir, `match-${stamp()}.db`);
  admin.backupTo(file);
  res.setHeader('cache-control', 'no-store');
  res.download(file, `match-${stamp()}.db`, () => rmSync(dir, { recursive: true, force: true }));
});
