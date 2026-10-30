import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { courtLabels, defaultRules, defaultSettings, formatInfo, MANUAL_RETENTION_DAYS, MAX_COURTS } from '../shared/formats.ts';
import type { Booking, FormatId, Gender, Level, Session } from '../shared/types.ts';
import { maskPhone, normalizeName, normalizePhone, uid } from '../shared/util.ts';
import { applyAction, cleanName, HttpError, newPlayer, type Role } from './actions.ts';
import { accounts, hostById, hosts, playerTokens, sessions, type Host } from './db.ts';
import { findBookings, isMock, MOCK_ACCOUNTS } from './winscourt.ts';
import { adminRouter } from './admin.ts';
import { modelsRouter } from './models.ts';

const app = express();
app.use(express.json({ limit: '200kb' }));

// Server-Timing: lama proses di aplikasi (ms). Bandingkan dengan TTFB di browser/curl
// untuk membedakan lambat di aplikasi vs lambat di jaringan (Cloudflare ↔ server).
app.use((_req, res, next) => {
  const t0 = performance.now();
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: Parameters<Response['writeHead']>) {
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${(performance.now() - t0).toFixed(1)}`);
    return writeHead.apply(this, args);
  } as Response['writeHead'];
  next();
});
app.disable('x-powered-by');

/* ---------------- util ---------------- */

const token = () => randomBytes(24).toString('hex');
const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');
const pinOk = (pin: string, salt: string, hash: string) => {
  const a = Buffer.from(hashPin(pin, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

function hostFrom(req: Request): Host | undefined {
  const h = req.get('authorization');
  if (!h?.startsWith('Bearer ')) return undefined;
  return hosts.byToken(h.slice(7));
}

function requireHost(req: Request): Host {
  const h = hostFrom(req);
  if (!h) throw new HttpError(401, 'Silakan login dengan nama dan no. HP penyewa');
  return h;
}

function roleFor(req: Request, s: Session): Role {
  const host = hostFrom(req);
  const isHost = !!host && host.id === s.hostId;
  const ref = req.get('x-ref-key');
  const pt = req.get('x-player-token');
  const playerId = pt ? playerTokens.resolve(pt, s.id) : undefined;
  return { host: isHost, referee: isHost || (!!ref && ref === s.refKey), playerId };
}

/** Versi sesi untuk publik: tanpa PIN, tanpa kunci wasit. */
function publicSession(s: Session, includeKey = false): Session {
  return {
    ...s,
    refKey: includeKey ? s.refKey : '',
    players: s.players.map(({ pinHash, ...p }) => ({ ...p, hasPin: !!pinHash })),
  };
}

const loadSession = (slug: string): Session => {
  const s = sessions.get(slug);
  if (!s) throw new HttpError(404, `Sesi tidak ditemukan. Sesi manual akun umum dihapus otomatis ${MANUAL_RETENTION_DAYS} hari setelah jam main.`);
  // Rapikan data lama: "Badminton N" → "Line N", dan nama "1. Ayu" → "Ayu".
  const before = JSON.stringify([s.courtNames, s.players.map((p) => p.name)]);
  if (s.sport === 'badminton') s.courtNames = s.courtNames.map((n) => n.replace(/^Badminton (\d)$/, 'Line $1'));
  for (const p of s.players) p.name = cleanName(p.name) || p.name;
  if (JSON.stringify([s.courtNames, s.players.map((p) => p.name)]) !== before) sessions.save(s);
  return s;
};

/* ---------------- realtime (SSE) ---------------- */

const streams = new Map<string, Set<Response>>();

function broadcast(s: Session) {
  const set = streams.get(s.slug);
  if (!set?.size) return;
  const data = `data: ${JSON.stringify(publicSession(s))}\n\n`;
  for (const res of set) res.write(data);
}

function save(s: Session) {
  s.version++;
  sessions.save(s);
  broadcast(s);
}

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25_000).unref();

/* ---------------- rate limit login ---------------- */

const attempts = new Map<string, { n: number; reset: number }>();
function rateLimit(phone: string) {
  const now = Date.now();
  const a = attempts.get(phone);
  if (!a || a.reset < now) {
    attempts.set(phone, { n: 1, reset: now + 15 * 60_000 });
    return;
  }
  a.n++;
  if (a.n > 5) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
}

/* ---------------- sinkron booking ---------------- */

const syncing = new Set<string>();

/**
 * Sinkron jam main & nomor Line dari Wins Court (maks. tiap 5 menit) di LATAR BELAKANG,
 * agar halaman sesi tidak menunggu API Wins Court. Perubahan dikirim ke semua HP lewat SSE.
 */
function syncBookingInBackground(slug: string, host: Host) {
  const s0 = sessions.get(slug);
  if (!s0 || s0.status === 'finished' || isManual(s0.bookingId) || syncing.has(slug)) return;
  if (s0.bookingSyncedAt && Date.now() - s0.bookingSyncedAt < 5 * 60_000) return;
  syncing.add(slug);
  findBookings(host.name, host.phone, { fresh: true })
    .then((list) => {
      // Muat ulang sesi terbaru: jangan menimpa aksi yang terjadi selama menunggu API.
      const s = sessions.get(slug);
      if (!s) return;
      const b = list.find((x) => x.id === s.bookingId);
      s.bookingSyncedAt = Date.now();
      if (!b) {
        // Booking lama yang sudah lewat tidak lagi dikembalikan API; hanya tandai batal jika jam main belum lewat.
        if (new Date(s.end).getTime() > Date.now()) s.bookingCancelled = true;
      } else {
        s.bookingCancelled = false;
        s.start = b.start;
        s.end = b.end;
        if (b.courts.length >= s.courts) s.courtNames = courtLabels(s.sport, b.courts.slice(0, s.courts));
      }
      save(s);
    })
    .catch(() => {
      /* Wins Court tidak bisa dihubungi: coba lagi di kunjungan berikutnya */
    })
    .finally(() => syncing.delete(slug));
}

/* ---------------- routes ---------------- */

const api = express.Router();

api.get('/config', (_req, res) => {
  res.json({ mock: isMock, mockAccounts: isMock ? MOCK_ACCOUNTS : [], maxCourts: MAX_COURTS, manualRetentionDays: MANUAL_RETENTION_DAYS });
});

api.post('/auth/login', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const phone = normalizePhone(String(req.body?.phone ?? ''));
  if (!name || phone.length < 9) throw new HttpError(400, 'Isi nama dan no. HP yang dipakai saat booking');
  rateLimit(phone);
  const bookings = await findBookings(name, phone);
  if (!bookings.length) throw new HttpError(404, 'Nama atau no. HP tidak ditemukan di jadwal Wins Court');
  attempts.delete(phone);
  const existing = hosts.byPhone(phone);
  const host = hosts.upsert({ id: existing?.id ?? uid(12), name: bookings[0].name || name, phone, token: existing?.token ?? token() });
  res.json({ token: host.token, host: { name: host.name, phone: maskPhone(phone) }, bookings });
});

/* ---------- akun umum: nama + email + no. HP + PIN 6 digit ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function weakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true; // 000000, 111111, …
  const d = pin.split('').map(Number);
  const step = (k: number) => d.every((x, i) => i === 0 || x === (d[i - 1] + k + 10) % 10);
  return step(1) || step(-1); // 123456, 654321, 890123, …
}

const accountJson = (host: Host, email: string | null) => ({
  name: host.name,
  phone: maskPhone(host.phone),
  email: email ? email.replace(/^(.).*?(@.*)$/, '$1•••$2') : null,
});

api.post('/auth/register', (req, res) => {
  const name = cleanName(req.body?.name).slice(0, 60);
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 120);
  const phone = normalizePhone(String(req.body?.phone ?? ''));
  const pin = String(req.body?.pin ?? '');
  if (name.length < 2) throw new HttpError(400, 'Isi nama lengkap');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Format email tidak valid');
  if (!/^62\d{8,13}$/.test(phone)) throw new HttpError(400, 'No. HP tidak valid (contoh: 0812xxxxxxx)');
  if (!/^\d{6}$/.test(pin)) throw new HttpError(400, 'PIN harus 6 angka');
  if (weakPin(pin)) throw new HttpError(400, 'PIN terlalu mudah ditebak. Hindari angka sama atau berurutan.');
  rateLimit(`reg:${phone}`);
  if (accounts.byEmail(email)) throw new HttpError(409, 'Email sudah terdaftar. Silakan masuk.');
  const existing = hosts.byPhone(phone);
  if (existing && accounts.byHost(existing.id)) throw new HttpError(409, 'No. HP sudah terdaftar. Silakan masuk.');
  // No. HP yang pernah login sebagai penyewa Wins Court tersambung ke akun ini (sesi lamanya tetap terlihat).
  const host = hosts.upsert({ id: existing?.id ?? uid(12), name, phone, token: existing?.token ?? token() });
  const salt = randomBytes(16).toString('hex');
  accounts.create({ host_id: host.id, email, pin_hash: hashPin(pin, salt), pin_salt: salt });
  res.json({ token: host.token, host: accountJson(host, email) });
});

api.post('/auth/account-login', (req, res) => {
  const id = String(req.body?.id ?? '').trim().toLowerCase();
  const pin = String(req.body?.pin ?? '');
  if (!id || !/^\d{6}$/.test(pin)) throw new HttpError(400, 'Isi no. HP atau email, dan PIN 6 angka');
  const isEmail = id.includes('@');
  const key = `acc:${isEmail ? id : normalizePhone(id)}`;
  rateLimit(key);
  const acc = isEmail ? accounts.byEmail(id) : (() => {
    const h = hosts.byPhone(normalizePhone(id));
    return h ? accounts.byHost(h.id) : undefined;
  })();
  const host = acc ? hostById(acc.host_id) : undefined;
  // Pesan sama untuk akun tidak ada & PIN salah (tidak membocorkan siapa yang terdaftar).
  if (!acc || !host || !pinOk(pin, acc.pin_salt, acc.pin_hash)) throw new HttpError(401, 'No. HP/email atau PIN salah');
  attempts.delete(key);
  res.json({ token: host.token, host: accountJson(host, acc.email) });
});

api.get('/me', async (req, res) => {
  const host = requireHost(req);
  const acc = accounts.byHost(host.id);
  let bookings: Booking[] = [];
  try {
    bookings = await findBookings(host.name, host.phone);
  } catch {
    /* Wins Court tidak bisa dihubungi: tetap tampilkan sesi */
  }
  const list = sessions.byHost(host.id).map((s) => ({
    slug: s.slug,
    name: s.name,
    sport: s.sport,
    format: s.format,
    status: s.status,
    start: s.start,
    end: s.end,
    courts: s.courts,
    bookingId: s.bookingId,
    players: s.players.filter((p) => p.status !== 'waitlist' && p.status !== 'left').length,
    waitlist: s.players.filter((p) => p.status === 'waitlist').length,
  }));
  res.json({ host: accountJson(host, acc?.email ?? null), account: !!acc, bookings, sessions: list });
});

/** Sesi manual (akun umum): olahraga, tanggal, jam & jumlah lapangan diisi sendiri, tanpa booking Wins Court. */
function manualBooking(host: Host, m: Record<string, unknown>): Booking {
  const sport = m.sport === 'padel' ? 'padel' : m.sport === 'badminton' ? 'badminton' : null;
  if (!sport) throw new HttpError(400, 'Pilih olahraga');
  const date = String(m.date ?? '');
  const from = String(m.start ?? '');
  const to = String(m.end ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw new HttpError(400, 'Isi tanggal dan jam main');
  const start = `${date}T${from}:00+07:00`;
  const end = to === '24:00' ? `${date}T23:59:59+07:00` : `${date}T${to}:00+07:00`;
  const t0 = Date.parse(start);
  const t1 = Date.parse(end);
  if (Number.isNaN(t0) || Number.isNaN(t1)) throw new HttpError(400, 'Tanggal atau jam tidak valid');
  const minutes = (t1 - t0) / 60_000;
  if (minutes < 30 || minutes > 8 * 60) throw new HttpError(400, 'Durasi main 30 menit sampai 8 jam (jam selesai harus setelah jam mulai)');
  if (t1 < Date.now() - 12 * 3600_000 || t0 > Date.now() + 60 * 86_400_000) throw new HttpError(400, 'Tanggal main maksimal 60 hari ke depan');
  const n = sport === 'padel' ? 1 : Math.max(1, Math.min(MAX_COURTS.badminton, Math.floor(Number(m.courts) || 1)));
  return { id: `MANUAL-${uid(8)}`, name: host.name, phone: host.phone, sport, courts: Array.from({ length: n }, (_, i) => i + 1), start, end };
}

const isManual = (bookingId: string) => bookingId.startsWith('MANUAL-');

api.post('/sessions', async (req, res) => {
  const host = requireHost(req);
  const body = req.body ?? {};
  let b: Booking;
  if (body.manual) {
    if (!accounts.byHost(host.id)) throw new HttpError(403, 'Sesi manual hanya untuk akun umum. Daftar akun dulu.');
    b = manualBooking(host, body.manual);
  } else {
    const bookings = await findBookings(host.name, host.phone);
    const found = bookings.find((x) => x.id === String(body.bookingId));
    if (!found) throw new HttpError(404, 'Booking tidak ditemukan untuk akun ini');
    b = found;
    const dup = sessions.byHost(host.id).find((s) => s.bookingId === b.id);
    if (dup) throw new HttpError(409, `Booking ini sudah punya sesi: ${dup.name}`);
  }
  const format: FormatId = formatInfo(body.format).sports.includes(b.sport) ? formatInfo(body.format).id : b.sport === 'badminton' ? 'rotation' : 'americano';
  const courts = Math.max(1, Math.min(MAX_COURTS[b.sport], b.courts.length));
  if (courts < formatInfo(format).minCourts) throw new HttpError(400, 'Format ini butuh lebih banyak lapangan');
  const rules = { ...defaultRules(b.sport), ...(body.rules ?? {}) };
  if (b.sport === 'badminton') rules.kind = 'rally';
  else if (rules.kind === 'rally') rules.kind = 'points';
  const teamSize = b.sport === 'padel' || formatInfo(format).mixed ? 2 : body.teamSize === 1 ? 1 : 2;
  const s: Session = {
    id: uid(12),
    slug: uid(10),
    refKey: uid(16),
    hostId: host.id,
    hostName: host.name,
    sport: b.sport,
    format,
    name: String(body.name ?? '').trim().slice(0, 60) || `Mabar ${b.sport === 'padel' ? 'Padel' : 'Badminton'}`,
    bookingId: b.id,
    start: b.start,
    end: b.end,
    courts,
    courtNames: isManual(b.id) ? (b.sport === 'padel' ? ['Padel'] : b.courts.slice(0, courts).map((c) => `Lapangan ${c}`)) : courtLabels(b.sport, b.courts.slice(0, courts)),
    teamSize,
    rules,
    maxPlayers: Number.isInteger(body.maxPlayers) && body.maxPlayers > 0 ? body.maxPlayers : null,
    settings: { ...defaultSettings(), ...(body.settings ?? {}) },
    players: [],
    rounds: [],
    status: 'draft',
    createdAt: Date.now(),
    bookingSyncedAt: Date.now(),
    version: 0,
  };
  const names: string[] = Array.isArray(body.names) ? body.names : [];
  const seen = new Set<string>();
  for (const n of names.map(cleanName).filter(Boolean).slice(0, 100)) {
    if (seen.has(normalizeName(n))) continue;
    seen.add(normalizeName(n));
    s.players.push(newPlayer(n));
  }
  sessions.save(s);
  res.json({ slug: s.slug });
});

api.get('/s/:slug', (req, res) => {
  const s = loadSession(req.params.slug);
  const role = roleFor(req, s);
  if (role.host) syncBookingInBackground(s.slug, hostFrom(req)!);
  res.json({ session: publicSession(s, role.host), role: role.host ? 'host' : role.referee ? 'referee' : role.playerId ? 'player' : 'viewer', playerId: role.playerId ?? null });
});

api.get('/s/:slug/stream', (req, res) => {
  const s = loadSession(req.params.slug);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 3000\ndata: ${JSON.stringify(publicSession(s))}\n\n`);
  let set = streams.get(s.slug);
  if (!set) streams.set(s.slug, (set = new Set()));
  set.add(res);
  req.on('close', () => {
    set!.delete(res);
    if (!set!.size) streams.delete(s.slug);
  });
});

api.post('/s/:slug/action', (req, res) => {
  const s = loadSession(req.params.slug);
  const role = roleFor(req, s);
  const body = req.body ?? {};
  if (Number.isInteger(body.version) && body.version !== s.version && body.type === 'editMatch') {
    throw new HttpError(409, 'Ronde baru saja diubah orang lain. Muat ulang lalu coba lagi.');
  }
  applyAction(s, body, role);
  save(s);
  res.json({ session: publicSession(s, role.host) });
});

api.post('/s/:slug/join', (req, res) => {
  const s = loadSession(req.params.slug);
  const name = cleanName(req.body?.name).slice(0, 40);
  const pin = String(req.body?.pin ?? '');
  if (!name) throw new HttpError(400, 'Isi nickname');
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'PIN harus 4 angka');
  const mode = String(req.body?.mode ?? 'auto'); // login | claim | new | auto
  const existing = s.players.find((p) => normalizeName(p.name) === normalizeName(name));
  if (s.status === 'finished' && !(existing && mode === 'login')) throw new HttpError(400, 'Sesi sudah selesai');
  if (mode === 'login' && !existing) throw new HttpError(404, 'Nama tidak ada di sesi ini. Daftar baru, atau minta host menambahkan namamu.');
  if (mode === 'login' && existing && !existing.pinHash) throw new HttpError(400, 'Kamu belum punya PIN. Pilih namamu di tab "Pilih nama" lalu ketuk "Ini aku".');
  if (mode === 'claim' && existing?.pinHash) throw new HttpError(409, 'Nama ini sudah punya PIN. Masuk dengan PIN-nya.');
  if (mode === 'new' && existing) throw new HttpError(409, 'Nama sudah ada di sesi. Pilih namamu di tab "Pilih nama".');
  let playerId: string;
  if (existing) {
    if (existing.pinHash) {
      rateLimit(`${s.id}:${existing.id}`);
      if (!pinOk(pin, s.id + existing.id, existing.pinHash)) throw new HttpError(403, 'PIN salah. Lupa PIN? Minta host mereset.');
      attempts.delete(`${s.id}:${existing.id}`);
    } else {
      // Pemain yang ditambahkan host mengklaim namanya dengan PIN baru.
      existing.pinHash = hashPin(pin, s.id + existing.id);
    }
    playerId = existing.id;
  } else {
    const gender: Gender = req.body?.gender === 'F' ? 'F' : 'M';
    const level = ([1, 2, 3, 4].includes(req.body?.level) ? req.body.level : 1) as Level;
    const p = newPlayer(name, { gender, level, status: 'waitlist' });
    p.pinHash = hashPin(pin, s.id + p.id);
    s.players.push(p);
    playerId = p.id;
  }
  const t = token();
  playerTokens.create(t, s.id, playerId);
  save(s);
  res.json({ token: t, playerId, session: publicSession(s) });
});

api.delete('/s/:slug', (req, res) => {
  const s = loadSession(req.params.slug);
  if (!roleFor(req, s).host) throw new HttpError(403, 'Hanya host yang bisa menghapus sesi');
  sessions.remove(s.id);
  for (const r of streams.get(s.slug) ?? []) r.end();
  streams.delete(s.slug);
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

/* ---------------- model AI analisis reli ---------------- */

app.use('/models', modelsRouter);

/* ---------------- frontend (build) ---------------- */

const dist = resolve('dist');
if (existsSync(dist)) {
  // Aset ber-hash (index-abc123.js) tidak pernah berubah isinya → boleh di-cache lama.
  app.use('/assets', express.static(resolve(dist, 'assets'), { index: false, immutable: true, maxAge: '1y' }));
  // Aset yang tidak ada (mis. dari halaman versi lama) → 404, JANGAN dibalas index.html:
  // Safari menolak HTML sebagai JavaScript dan halaman jadi putih kosong.
  app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Not found'));
  // Mesin AI (WASM MediaPipe) — folder ber-versi, isinya tidak pernah berubah.
  app.use('/mediapipe', express.static(resolve(dist, 'mediapipe'), { index: false, immutable: true, maxAge: '1y' }));
  app.use('/mediapipe', (_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  // Rute aplikasi (tanpa ekstensi file) → index.html, selalu dicek ulang agar tidak memakai versi lama.
  app.get(/^(?!\/api)(?!.*\.[a-z0-9]{1,8}$).*/i, (_req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(resolve(dist, 'index.html'));
  });
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

/* ---------------- masa simpan data akun umum ---------------- */

// Data pertandingan sesi manual (akun umum) disimpan 30 hari setelah jam main selesai.
// Angka dari shared/formats.ts agar sama dengan yang tampil di aplikasi.

function purgeOldManualSessions() {
  try {
    const { slugs } = sessions.purgeManual(MANUAL_RETENTION_DAYS);
    for (const slug of slugs) {
      for (const r of streams.get(slug) ?? []) r.end();
      streams.delete(slug);
    }
    if (slugs.length) console.log(`[masa simpan] ${slugs.length} sesi manual > ${MANUAL_RETENTION_DAYS} hari dihapus`);
  } catch (e) {
    console.error('[masa simpan] gagal:', e);
  }
}
purgeOldManualSessions();
setInterval(purgeOldManualSessions, 6 * 3600_000).unref();

const port = Number(process.env.PORT ?? 8787);
const server = app.listen(port, () => {
  console.log(`match.wins-court.com API di http://localhost:${port} ${isMock ? '(data booking: MOCK)' : ''}`);
});
// Koneksi keep-alive dipertahankan lebih lama dari browser/proxy (default Node 5 dtk):
// mencegah Safari memakai ulang koneksi yang sudah ditutup server ("network connection was lost").
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
