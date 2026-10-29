import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { courtLabels, defaultRules, defaultSettings, formatInfo, MAX_COURTS } from '../shared/formats.ts';
import type { Booking, FormatId, Gender, Level, Session } from '../shared/types.ts';
import { maskPhone, normalizeName, normalizePhone, uid } from '../shared/util.ts';
import { applyAction, cleanName, HttpError, newPlayer, type Role } from './actions.ts';
import { hosts, playerTokens, sessions, type Host } from './db.ts';
import { findBookings, isMock, MOCK_ACCOUNTS } from './winscourt.ts';

const app = express();
app.use(express.json({ limit: '200kb' }));
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
  if (!s) throw new HttpError(404, 'Sesi tidak ditemukan');
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

async function syncBooking(s: Session, host: Host): Promise<boolean> {
  if (s.status === 'finished' || (s.bookingSyncedAt && Date.now() - s.bookingSyncedAt < 5 * 60_000)) return false;
  try {
    const list = await findBookings(host.name, host.phone);
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
    return true;
  } catch {
    return false;
  }
}

/* ---------------- routes ---------------- */

const api = express.Router();

api.get('/config', (_req, res) => {
  res.json({ mock: isMock, mockAccounts: isMock ? MOCK_ACCOUNTS : [], maxCourts: MAX_COURTS });
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

api.get('/me', async (req, res) => {
  const host = requireHost(req);
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
  res.json({ host: { name: host.name, phone: maskPhone(host.phone) }, bookings, sessions: list });
});

api.post('/sessions', async (req, res) => {
  const host = requireHost(req);
  const body = req.body ?? {};
  const bookings = await findBookings(host.name, host.phone);
  const b = bookings.find((x) => x.id === String(body.bookingId));
  if (!b) throw new HttpError(404, 'Booking tidak ditemukan untuk akun ini');
  const dup = sessions.byHost(host.id).find((s) => s.bookingId === b.id);
  if (dup) throw new HttpError(409, `Booking ini sudah punya sesi: ${dup.name}`);
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
    courtNames: courtLabels(b.sport, b.courts.slice(0, courts)),
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

api.get('/s/:slug', async (req, res) => {
  const s = loadSession(req.params.slug);
  const role = roleFor(req, s);
  if (role.host) {
    const host = hostFrom(req)!;
    if (await syncBooking(s, host)) save(s);
  }
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

app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

/* ---------------- frontend (build) ---------------- */

const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`match.wins-court.com API di http://localhost:${port} ${isMock ? '(data booking: MOCK)' : ''}`);
});
