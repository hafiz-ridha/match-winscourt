import { busyPlayers, currentRound, ensureRounds, initBracket, regenerateFuture, roundDone } from '../shared/engine.ts';
import { formatInfo, MAX_COURTS } from '../shared/formats.ts';
import { matchScore } from '../shared/standings.ts';
import type { Gender, Level, Match, Player, PlayerStatus, Session, Side } from '../shared/types.ts';
import { normalizeName, uid } from '../shared/util.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Role {
  host: boolean;
  referee: boolean;
  playerId?: string;
}

const fail = (msg: string, status = 400): never => {
  throw new HttpError(status, msg);
};

const START_EARLY_MS = 15 * 60_000;

function findMatch(s: Session, id: string): Match {
  for (const r of s.rounds) {
    const m = r.matches.find((x) => x.id === id);
    if (m) return m;
  }
  return fail('Match tidak ditemukan', 404);
}

function findPlayer(s: Session, id: string): Player {
  return s.players.find((p) => p.id === id) ?? fail('Pemain tidak ditemukan', 404);
}

const LEVELS = [1, 2, 3, 4];
const STATUSES: PlayerStatus[] = ['waitlist', 'active', 'rest', 'late', 'left'];

/** "1. Ayu" / "2) Budi" dari daftar WhatsApp → "Ayu". */
export const cleanName = (x: unknown) =>
  String(x ?? '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();

export function newPlayer(name: string, opts: { gender?: Gender; level?: Level; status?: PlayerStatus } = {}): Player {
  return {
    id: uid(8),
    name: name.trim().slice(0, 40),
    gender: opts.gender ?? 'M',
    level: opts.level ?? 1,
    status: opts.status ?? 'active',
    joinedAt: Date.now(),
  };
}

export function minPlayers(s: Session): number {
  const info = formatInfo(s.format);
  if (info.bracket) return s.teamSize * 2;
  return s.teamSize * 2;
}

/** Terapkan aksi ke sesi. Mengembalikan true jika sesi berubah. */
export function applyAction(s: Session, a: Record<string, any>, role: Role): void {
  const type = String(a.type ?? '');
  const hostOnly = () => role.host || fail('Hanya host yang bisa melakukan ini', 403);
  const scorer = () => role.host || role.referee || fail('Hanya host atau wasit yang bisa mencatat skor', 403);
  const running = () => s.status === 'running' || fail('Sesi belum dimulai atau sudah selesai');

  switch (type) {
    /* ---------------- pengaturan & pemain (host) ---------------- */
    case 'settings': {
      hostOnly();
      if (typeof a.name === 'string' && a.name.trim()) s.name = a.name.trim().slice(0, 60);
      if (a.maxPlayers === null || (Number.isInteger(a.maxPlayers) && a.maxPlayers > 0)) s.maxPlayers = a.maxPlayers;
      if (a.rules && typeof a.rules === 'object') {
        const r = { ...s.rules, ...a.rules };
        if (s.sport === 'badminton') r.kind = 'rally';
        else if (r.kind === 'rally') r.kind = 'points';
        r.target = Math.max(0, Math.min(99, Number(r.target) || 0));
        if (r.kind === 'rally' && r.target < 5) r.target = 21;
        r.games = Math.max(1, Math.min(30, Number(r.games) || 6));
        s.rules = r;
      }
      let regen = false;
      if (a.settings && typeof a.settings === 'object') {
        const before = JSON.stringify([s.settings.levelBalance, s.settings.lookahead]);
        s.settings = { ...s.settings, ...a.settings };
        s.settings.lookahead = Math.max(1, Math.min(8, Number(s.settings.lookahead) || 4));
        regen = before !== JSON.stringify([s.settings.levelBalance, s.settings.lookahead]);
      }
      if (s.status === 'draft') {
        if (a.format && formatInfo(a.format).sports.includes(s.sport) && s.courts >= formatInfo(a.format).minCourts) s.format = a.format;
        if (a.teamSize === 1 || a.teamSize === 2) s.teamSize = a.teamSize;
        if (formatInfo(s.format).mixed || s.sport === 'padel') s.teamSize = 2;
      }
      if (regen) regenerateFuture(s);
      break;
    }
    case 'addPlayers': {
      hostOnly();
      const names: string[] = (Array.isArray(a.names) ? a.names : []).map(cleanName).filter(Boolean);
      const existing = new Set(s.players.map((p) => normalizeName(p.name)));
      for (const n of names.slice(0, 100)) {
        if (existing.has(normalizeName(n))) continue;
        existing.add(normalizeName(n));
        s.players.push(newPlayer(n, { gender: a.gender === 'F' ? 'F' : 'M', level: LEVELS.includes(a.level) ? a.level : 1 }));
      }
      regenerateFuture(s);
      break;
    }
    case 'updatePlayer': {
      hostOnly();
      const p = findPlayer(s, a.id);
      const patch = a.patch ?? {};
      if (typeof patch.name === 'string' && cleanName(patch.name)) p.name = cleanName(patch.name).slice(0, 40);
      if (patch.gender === 'M' || patch.gender === 'F') p.gender = patch.gender;
      if (LEVELS.includes(patch.level)) p.level = patch.level;
      if (STATUSES.includes(patch.status)) p.status = patch.status;
      if ('pair' in patch) p.pair = patch.pair ? String(patch.pair) : undefined;
      if ('club' in patch) p.club = patch.club === 'A' || patch.club === 'B' ? patch.club : undefined;
      if ('guest' in patch) p.guest = !!patch.guest;
      regenerateFuture(s);
      break;
    }
    case 'resetPin': {
      hostOnly();
      findPlayer(s, a.id).pinHash = undefined;
      break;
    }
    case 'removePlayer': {
      hostOnly();
      const p = findPlayer(s, a.id);
      const played = s.rounds.some((r) => r.matches.some((m) => m.status !== 'scheduled' && (m.a.includes(p.id) || m.b.includes(p.id))));
      if (played) p.status = 'left';
      else s.players = s.players.filter((x) => x.id !== p.id);
      regenerateFuture(s);
      break;
    }
    case 'approve': {
      hostOnly();
      findPlayer(s, a.id).status = 'active';
      regenerateFuture(s);
      break;
    }
    case 'approveAll': {
      hostOnly();
      for (const p of s.players) if (p.status === 'waitlist') p.status = 'active';
      regenerateFuture(s);
      break;
    }
    case 'autoPairs': {
      hostOnly();
      const free = s.players.filter((p) => p.status === 'active' && !p.pair).sort((x, y) => y.level - x.level);
      const info = formatInfo(s.format);
      if (info.mixed) {
        const men = free.filter((p) => p.gender === 'M');
        const women = free.filter((p) => p.gender === 'F').reverse();
        for (let i = 0; i < Math.min(men.length, women.length); i++) men[i].pair = women[i].pair = uid(6);
      } else {
        while (free.length >= 2) {
          const hi = free.shift()!;
          const lo = free.pop()!;
          hi.pair = lo.pair = uid(6);
        }
      }
      regenerateFuture(s);
      break;
    }
    case 'clearPairs': {
      hostOnly();
      if (s.status !== 'draft') fail('Pasangan hanya bisa diatur ulang sebelum sesi dimulai');
      for (const p of s.players) p.pair = undefined;
      break;
    }
    case 'autoClubs': {
      hostOnly();
      const list = s.players.filter((p) => p.status !== 'left').sort((x, y) => y.level - x.level);
      list.forEach((p, i) => (p.club = i % 4 === 0 || i % 4 === 3 ? 'A' : 'B'));
      regenerateFuture(s);
      break;
    }

    /* ---------------- alur sesi (host) ---------------- */
    case 'start': {
      hostOnly();
      if (s.status !== 'draft') fail('Sesi sudah dimulai');
      if (Date.now() < new Date(s.start).getTime() - START_EARLY_MS) fail('Sesi bisa dimulai 15 menit sebelum jam main');
      const active = s.players.filter((p) => p.status === 'active');
      if (active.length < minPlayers(s)) fail(`Butuh minimal ${minPlayers(s)} pemain aktif`);
      const info = formatInfo(s.format);
      if (info.mixed) {
        const m = active.filter((p) => p.gender === 'M').length;
        const f = active.filter((p) => p.gender === 'F').length;
        if (m < 2 || f < 2) fail('Format campuran butuh minimal 2 putra dan 2 putri');
      }
      if (info.fixedPairs && s.teamSize === 2) {
        const pairs = new Map<string, number>();
        for (const p of active) if (p.pair) pairs.set(p.pair, (pairs.get(p.pair) ?? 0) + 1);
        if ([...pairs.values()].filter((n) => n === 2).length < 2) fail('Atur minimal 2 pasangan tetap dulu (tombol "Pasangkan otomatis")');
      }
      if (info.clubs) for (const p of active) if (!p.club) p.club = 'A';
      s.status = 'running';
      s.startedAt = Date.now();
      if (info.bracket) initBracket(s);
      ensureRounds(s);
      if (!s.rounds.length && !info.manual) fail('Belum bisa menyusun ronde dari pemain yang ada');
      break;
    }
    case 'regenerate': {
      hostOnly();
      running();
      regenerateFuture(s);
      break;
    }
    case 'closeRound': {
      hostOnly();
      running();
      const r = currentRound(s) ?? fail('Tidak ada ronde berjalan');
      r.matches = r.matches.filter((m) => m.status === 'done' || m.events.length > 0 || m.final);
      for (const m of r.matches) {
        if (m.status !== 'done') {
          m.status = 'done';
          m.endedAt = Date.now();
        }
      }
      if (!r.matches.length) s.rounds = s.rounds.filter((x) => x !== r);
      s.rounds.forEach((x, i) => (x.n = i + 1));
      ensureRounds(s);
      break;
    }
    case 'editMatch': {
      hostOnly();
      running();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done') fail('Match sudah selesai');
      const ids = new Set(s.players.map((p) => p.id));
      const A: string[] = (a.a ?? []).filter((id: string) => ids.has(id));
      const B: string[] = (a.b ?? []).filter((id: string) => ids.has(id));
      if (A.length !== s.teamSize || B.length !== s.teamSize) fail('Jumlah pemain per tim tidak sesuai');
      const round = s.rounds.find((r) => r.matches.includes(m))!;
      const all = [...A, ...B];
      if (new Set(all).size !== all.length) fail('Pemain tidak boleh dobel');
      for (const other of round.matches) if (other !== m && [...other.a, ...other.b].some((id) => all.includes(id))) fail('Pemain sudah main di lapangan lain pada ronde ini');
      m.a = A;
      m.b = B;
      const playing = new Set(round.matches.flatMap((x) => [...x.a, ...x.b]));
      round.resting = s.players.filter((p) => p.status === 'active' && !playing.has(p.id)).map((p) => p.id);
      round.locked = true;
      break;
    }
    case 'lockRound': {
      hostOnly();
      const r = s.rounds.find((x) => x.n === a.n) ?? fail('Ronde tidak ditemukan', 404);
      r.locked = !!a.locked;
      break;
    }
    case 'manualRound': {
      hostOnly();
      running();
      const list: { court: number; a: string[]; b: string[] }[] = Array.isArray(a.matches) ? a.matches : [];
      const ids = new Set(s.players.map((p) => p.id));
      const used = new Set<string>();
      const matches: Match[] = [];
      for (const x of list.slice(0, s.courts)) {
        const A = (x.a ?? []).filter((id) => ids.has(id));
        const B = (x.b ?? []).filter((id) => ids.has(id));
        if (A.length !== s.teamSize || B.length !== s.teamSize) continue;
        if ([...A, ...B].some((id) => used.has(id))) fail('Pemain tidak boleh dobel dalam satu ronde');
        [...A, ...B].forEach((id) => used.add(id));
        matches.push({ id: uid(8), court: Math.max(0, Math.min(s.courts - 1, Number(x.court) || 0)), a: A, b: B, events: [], status: 'scheduled' });
      }
      if (!matches.length) fail('Isi minimal satu match lengkap');
      s.rounds.push({
        n: s.rounds.length + 1,
        matches,
        resting: s.players.filter((p) => p.status === 'active' && !used.has(p.id)).map((p) => p.id),
        locked: true,
        manual: true,
      });
      break;
    }
    case 'deleteRound': {
      hostOnly();
      const r = s.rounds.find((x) => x.n === a.n) ?? fail('Ronde tidak ditemukan', 404);
      if (r.matches.some((m) => m.status !== 'scheduled' || m.events.length)) fail('Ronde sudah berjalan');
      s.rounds = s.rounds.filter((x) => x !== r);
      s.rounds.forEach((x, i) => (x.n = i + 1));
      break;
    }
    case 'finish': {
      hostOnly();
      if (s.status === 'draft') fail('Sesi belum dimulai');
      s.status = 'finished';
      s.finishedAt = Date.now();
      // Ronde yang belum disentuh tidak ikut arsip.
      s.rounds = s.rounds.filter((r) => r.matches.some((m) => m.status !== 'scheduled' || m.events.length));
      break;
    }
    case 'reopen': {
      hostOnly();
      if (s.status !== 'finished') fail('Sesi belum selesai');
      s.status = 'running';
      s.finishedAt = undefined;
      ensureRounds(s);
      break;
    }

    /* ---------------- skor (host / wasit) ---------------- */
    case 'point': {
      scorer();
      running();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done') fail('Match sudah selesai');
      const side: Side = a.side === 'b' ? 'b' : 'a';
      if (matchScore(s, m).done) break;
      if (m.status === 'scheduled' && m.events.length === 0) {
        const busy = busyPlayers(s, m);
        if (busy.length) fail(`${busy.map((id) => s.players.find((p) => p.id === id)?.name).join(', ')} masih main di lapangan lain`);
      }
      m.events.push(side);
      if (m.status === 'scheduled') {
        m.status = 'live';
        m.startedAt = Date.now();
      }
      break;
    }
    case 'minus': {
      scorer();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done') fail('Match sudah selesai');
      const i = m.events.lastIndexOf(a.side === 'b' ? 'b' : 'a');
      if (i >= 0) m.events.splice(i, 1);
      break;
    }
    case 'undo': {
      scorer();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done') fail('Match sudah selesai');
      m.events.pop();
      break;
    }
    case 'target': {
      scorer();
      const m = findMatch(s, a.matchId);
      m.target = Math.max(5, Math.min(99, Number(a.target) || s.rules.target));
      break;
    }
    case 'server': {
      scorer();
      findMatch(s, a.matchId).server = a.side === 'b' ? 'b' : 'a';
      break;
    }
    case 'swap': {
      scorer();
      const m = findMatch(s, a.matchId);
      m.swapped = !m.swapped;
      break;
    }
    case 'reset': {
      scorer();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done' && !role.host) fail('Hanya host yang bisa mengulang match selesai', 403);
      m.events = [];
      m.final = undefined;
      m.status = 'scheduled';
      m.target = undefined;
      break;
    }
    case 'final': {
      scorer();
      running();
      const m = findMatch(s, a.matchId);
      const num = (x: unknown) => Math.max(0, Math.min(999, Math.floor(Number(x) || 0)));
      const sets = Array.isArray(a.sets)
        ? (a.sets as unknown[][]).filter((x) => Array.isArray(x)).slice(0, 3).map((x) => [num(x[0]), num(x[1])] as [number, number]).filter(([x, y]) => x + y > 0)
        : undefined;
      m.final = { a: num(a.a), b: num(a.b), sets: s.rules.kind === 'sets' ? sets : undefined };
      if (formatInfo(s.format).bracket && matchScore(s, m).winner === 'draw') {
        m.final = undefined;
        fail('Format gugur harus ada pemenang');
      }
      m.status = 'done';
      m.endedAt = Date.now();
      ensureRounds(s);
      break;
    }
    case 'finishMatch': {
      scorer();
      running();
      const m = findMatch(s, a.matchId);
      if (m.status === 'done') break;
      const sc = matchScore(s, m);
      if (!sc.done && !(a.force && role.host)) fail('Skor belum memenuhi aturan menang');
      if (formatInfo(s.format).bracket && (sc.winner === 'draw' || !sc.winner)) fail('Format gugur harus ada pemenang');
      if (!sc.done) m.final = { a: sc.statA, b: sc.statB };
      m.status = 'done';
      m.endedAt = Date.now();
      ensureRounds(s);
      break;
    }
    case 'reopenMatch': {
      hostOnly();
      running();
      const m = findMatch(s, a.matchId);
      const round = s.rounds.find((r) => r.matches.includes(m))!;
      const later = s.rounds.filter((r) => r.n > round.n && r.matches.some((x) => x.status !== 'scheduled'));
      if (later.length && formatInfo(s.format).dynamic) fail('Ronde setelahnya sudah berjalan');
      m.status = m.events.length ? 'live' : 'scheduled';
      m.final = undefined;
      break;
    }
    default:
      fail(`Aksi tidak dikenal: ${type}`);
  }
}

export function validateCourts(sport: Session['sport'], courts: number): number {
  return Math.max(1, Math.min(MAX_COURTS[sport], courts));
}

export { roundDone };
