import { formatInfo } from './formats.ts';
import { matchScore, playerStandings, teamStandings, unitsOf } from './standings.ts';
import type { BracketMatch, FormatId, Match, Player, Round, Session, Side } from './types.ts';
import { shuffle, uid } from './util.ts';

/* ------------------------------------------------------------------ */
/* Statistik riwayat                                                   */
/* ------------------------------------------------------------------ */

interface History {
  played: Map<string, number>;
  last: Map<string, number>;
  partner: Map<string, number>;
  opp: Map<string, number>;
}

const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

function history(rounds: Round[]): History {
  const h: History = { played: new Map(), last: new Map(), partner: new Map(), opp: new Map() };
  for (const r of rounds) {
    for (const m of r.matches) {
      for (const team of [m.a, m.b]) {
        for (const id of team) {
          inc(h.played, id);
          h.last.set(id, r.n);
        }
        for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) inc(h.partner, key(team[i], team[j]));
      }
      for (const x of m.a) for (const y of m.b) inc(h.opp, key(x, y));
    }
  }
  return h;
}

export const activePlayers = (s: Session): Player[] => s.players.filter((p) => p.status === 'active');

/** Urutan adil: paling sedikit main, lalu paling lama menunggu, lalu acak. */
function byFairness(ids: string[], h: History): string[] {
  return shuffle(ids).sort((x, y) => {
    const d = (h.played.get(x) ?? 0) - (h.played.get(y) ?? 0);
    if (d) return d;
    return (h.last.get(x) ?? -1) - (h.last.get(y) ?? -1);
  });
}

/* ------------------------------------------------------------------ */
/* Pencarian susunan terbaik                                           */
/* ------------------------------------------------------------------ */

interface Weights {
  partner: number;
  opp: number;
  level: number;
}

type Team = string[];

function teamCost(s: Session, h: History, w: Weights, t1: Team, t2: Team): number {
  const lv = (id: string) => s.players.find((p) => p.id === id)?.level ?? 1;
  const g = (id: string) => s.players.find((p) => p.id === id)?.gender;
  const club = (id: string) => s.players.find((p) => p.id === id)?.club;
  let c = 0;
  for (const t of [t1, t2]) if (t.length === 2) c += w.partner * (h.partner.get(key(t[0], t[1])) ?? 0);
  for (const x of t1) for (const y of t2) c += w.opp * (h.opp.get(key(x, y)) ?? 0);
  const sum = (t: Team) => t.reduce((a, id) => a + lv(id), 0);
  c += w.level * Math.abs(sum(t1) - sum(t2));
  const info = formatInfo(s.format);
  if (info.mixed) for (const t of [t1, t2]) if (t.length === 2 && g(t[0]) === g(t[1])) c += 1000;
  if (info.clubs) {
    for (const t of [t1, t2]) if (t.length === 2 && club(t[0]) !== club(t[1])) c += 1000;
    if (club(t1[0]) === club(t2[0])) c += 1000;
  }
  return c;
}

/** Bagi pemain terpilih ke dalam K match dengan biaya terendah (pencarian acak + perbaikan lokal). */
function bestMatches(s: Session, h: History, w: Weights, ids: string[], k: number): [Team, Team][] {
  const size = s.teamSize;
  const per = size * 2;
  const splitGroup = (g: string[]): [Team, Team] & { cost?: number } => {
    if (size === 1) return [[g[0]], [g[1]]];
    const opts: [Team, Team][] = [
      [[g[0], g[1]], [g[2], g[3]]],
      [[g[0], g[2]], [g[1], g[3]]],
      [[g[0], g[3]], [g[1], g[2]]],
    ];
    let best = opts[0];
    let bc = Infinity;
    for (const o of opts) {
      const c = teamCost(s, h, w, o[0], o[1]);
      if (c < bc) {
        bc = c;
        best = o;
      }
    }
    return best;
  };
  const evaluate = (order: string[]) => {
    const ms: [Team, Team][] = [];
    let cost = 0;
    for (let i = 0; i < k; i++) {
      const m = splitGroup(order.slice(i * per, i * per + per));
      cost += teamCost(s, h, w, m[0], m[1]);
      ms.push(m);
    }
    return { ms, cost };
  };
  let bestOrder = shuffle(ids);
  let best = evaluate(bestOrder);
  const tries = Math.min(400, 40 + ids.length * 20);
  for (let t = 0; t < tries && best.cost > 0; t++) {
    const order = shuffle(ids);
    const r = evaluate(order);
    if (r.cost < best.cost) {
      best = r;
      bestOrder = order;
    }
  }
  for (let t = 0; t < 300 && best.cost > 0 && k > 1; t++) {
    const i = Math.floor(Math.random() * ids.length);
    const j = Math.floor(Math.random() * ids.length);
    if (Math.floor(i / per) === Math.floor(j / per)) continue;
    const order = bestOrder.slice();
    [order[i], order[j]] = [order[j], order[i]];
    const r = evaluate(order);
    if (r.cost <= best.cost) {
      best = r;
      bestOrder = order;
    }
  }
  return best.ms;
}

/* ------------------------------------------------------------------ */
/* Pembentuk ronde                                                     */
/* ------------------------------------------------------------------ */

const newMatch = (court: number, a: string[], b: string[], extra: Partial<Match> = {}): Match => ({
  id: uid(8),
  court,
  a,
  b,
  events: [],
  status: 'scheduled',
  ...extra,
});

function makeRound(s: Session, n: number, matches: Match[], active: string[]): Round {
  const playing = new Set(matches.flatMap((m) => [...m.a, ...m.b]));
  matches.sort((x, y) => x.court - y.court);
  return { n, matches, resting: active.filter((id) => !playing.has(id)), locked: false };
}

function weightsFor(s: Session): Weights {
  const lvl = s.settings.levelBalance ? 6 : 0;
  if (s.format === 'rotation' || s.format === 'winner_stays' || s.format === 'koth') return { partner: 8, opp: 3, level: lvl };
  return { partner: 20, opp: 4, level: lvl };
}

/** Pilih pemain untuk K match dengan kuota per kelompok (gender untuk mix, klub untuk club). */
function pickPlayers(s: Session, h: History, active: Player[]): { ids: string[]; k: number } {
  const info = formatInfo(s.format);
  const per = s.teamSize * 2;
  if (info.mixed || info.clubs) {
    const groupOf = (p: Player) => (info.mixed ? p.gender : (p.club ?? 'A'));
    const [g1, g2] = info.mixed ? ['M', 'F'] : ['A', 'B'];
    const a = active.filter((p) => groupOf(p) === g1).map((p) => p.id);
    const b = active.filter((p) => groupOf(p) === g2).map((p) => p.id);
    const half = per / 2;
    const k = Math.min(s.courts, Math.floor(Math.min(a.length, b.length) / half));
    return { ids: [...byFairness(a, h).slice(0, k * half), ...byFairness(b, h).slice(0, k * half)], k };
  }
  const k = Math.min(s.courts, Math.floor(active.length / per));
  return { ids: byFairness(active.map((p) => p.id), h).slice(0, k * per), k };
}

function genStatic(s: Session, n: number): Round | null {
  const courtAware = genCourtAware(s, n);
  if (courtAware) return courtAware;
  const active = activePlayers(s);
  const h = history(s.rounds);
  const { ids, k } = pickPlayers(s, h, active);
  if (k < 1) return null;
  const ms = bestMatches(s, h, weightsFor(s), ids, k);
  const courts = s.format === 'rotation' ? ms.map((_, i) => i) : shuffle(ms.map((_, i) => i));
  return makeRound(s, n, ms.map((m, i) => newMatch(courts[i], m[0], m[1])), active.map((p) => p.id));
}

function rankIndex(s: Session): Map<string, number> {
  const st = playerStandings(s);
  return new Map(st.map((x, i) => [x.id, i]));
}

function genMexicano(s: Session, n: number): Round | null {
  if (!s.rounds.some((r) => r.matches.some((m) => m.status === 'done'))) return genStatic(s, n);
  const active = activePlayers(s);
  const h = history(s.rounds);
  const rank = rankIndex(s);
  const byRank = (ids: string[]) => ids.slice().sort((x, y) => (rank.get(x) ?? 999) - (rank.get(y) ?? 999));
  const { ids, k } = pickPlayers(s, h, active);
  if (k < 1) return null;
  const matches: Match[] = [];
  if (s.format === 'mixicano') {
    const men = byRank(ids.filter((id) => s.players.find((p) => p.id === id)?.gender === 'M'));
    const women = byRank(ids.filter((id) => s.players.find((p) => p.id === id)?.gender === 'F'));
    for (let i = 0; i < k; i++) {
      const [m1, m2] = men.slice(i * 2, i * 2 + 2);
      const [w1, w2] = women.slice(i * 2, i * 2 + 2);
      matches.push(newMatch(i, [m1, w2], [m2, w1]));
    }
  } else {
    const ordered = byRank(ids);
    for (let i = 0; i < k; i++) {
      if (s.teamSize === 1) {
        const [p1, p2] = ordered.slice(i * 2, i * 2 + 2);
        matches.push(newMatch(i, [p1], [p2]));
      } else {
        const [p1, p2, p3, p4] = ordered.slice(i * 4, i * 4 + 4);
        matches.push(newMatch(i, [p1, p4], [p2, p3]));
      }
    }
  }
  return makeRound(s, n, matches, active.map((p) => p.id));
}

function genTeams(s: Session, n: number): Round | null {
  const units = unitsOf(s);
  const active = activePlayers(s).map((p) => p.id);
  const h = history(s.rounds);
  const playedU = (u: { members: string[] }) => h.played.get(u.members[0]) ?? 0;
  const lastU = (u: { members: string[] }) => h.last.get(u.members[0]) ?? -1;
  const ready = units.filter((u) => u.members.every((id) => active.includes(id)));
  const k = Math.min(s.courts, Math.floor(ready.length / 2));
  if (k < 1) return null;
  const chosen = shuffle(ready)
    .sort((x, y) => playedU(x) - playedU(y) || lastU(x) - lastU(y))
    .slice(0, k * 2);
  let pairs: [typeof chosen[number], typeof chosen[number]][] = [];
  const doneAny = s.rounds.some((r) => r.matches.some((m) => m.status === 'done'));
  if (s.format === 'team_mexicano' && doneAny) {
    const rank = new Map(teamStandings(s).map((x, i) => [x.id, i]));
    const ordered = chosen.slice().sort((x, y) => (rank.get(x.id) ?? 99) - (rank.get(y.id) ?? 99));
    for (let i = 0; i < k; i++) pairs.push([ordered[i * 2], ordered[i * 2 + 1]]);
  } else {
    const met = (x: typeof chosen[number], y: typeof chosen[number]) => h.opp.get(key(x.members[0], y.members[0])) ?? 0;
    let best = Infinity;
    for (let t = 0; t < 200; t++) {
      const o = shuffle(chosen);
      const cand: typeof pairs = [];
      let c = 0;
      for (let i = 0; i < k; i++) {
        cand.push([o[i * 2], o[i * 2 + 1]]);
        c += met(o[i * 2], o[i * 2 + 1]);
      }
      if (c < best) {
        best = c;
        pairs = cand;
      }
      if (c === 0) break;
    }
  }
  const matches = pairs.map(([x, y], i) => newMatch(i, x.members, y.members, { unitA: x.id, unitB: y.id }));
  return makeRound(s, n, matches, active);
}

function winnerOf(s: Session, m: Match): Side {
  const w = matchScore(s, m).winner;
  if (w === 'a' || w === 'b') return w;
  return 'a';
}

function genKoth(s: Session, n: number): Round | null {
  const prev = s.rounds.at(-1);
  if (!prev || !prev.matches.length) return genStatic(s, n);
  const active = activePlayers(s).map((p) => p.id);
  const per = s.teamSize * 2;
  const possible = Math.min(s.courts, Math.floor(active.length / per));
  if (possible !== prev.matches.length) return genStatic(s, n);
  const c = prev.matches.length;
  const ordered = prev.matches.slice().sort((x, y) => x.court - y.court);
  const groups: string[][][] = Array.from({ length: c }, () => []);
  ordered.forEach((m, i) => {
    const w = winnerOf(s, m);
    const win = w === 'a' ? m.a : m.b;
    const lose = w === 'a' ? m.b : m.a;
    groups[Math.max(0, i - 1)].push(win.slice());
    groups[Math.min(c - 1, i + 1)].push(lose.slice());
  });
  const h = history(s.rounds);
  const inPrev = new Set(ordered.flatMap((m) => [...m.a, ...m.b]));
  let bench = byFairness(active.filter((id) => !inPrev.has(id)), h);
  // Pemain yang bangku paling lama masuk di lapangan bawah, menggantikan tim kalah yang bertahan di bawah.
  const bottom = groups[c - 1];
  if (bench.length >= s.teamSize) {
    // Tim kalah lapangan bawah selalu didorong terakhir ke grup bawah.
    const idx = bottom.length - 1;
    const out = bottom[idx];
    bottom[idx] = bench.slice(0, s.teamSize);
    bench = [...bench.slice(s.teamSize), ...out];
  }
  // Ganti pemain yang sudah tidak aktif dengan pemain bangku.
  for (const g of groups)
    for (const t of g)
      for (let i = 0; i < t.length; i++)
        if (!active.includes(t[i])) {
          const sub = bench.shift();
          if (!sub) return genStatic(s, n);
          t[i] = sub;
        }
  const matches = groups.map((g, i) => {
    const [o1, o2] = g;
    if (!o1 || !o2) return null;
    if (s.teamSize === 1) return newMatch(i, o1, o2);
    return newMatch(i, [o1[0], o2[0]], [o1[1], o2[1]]);
  });
  if (matches.some((m) => !m)) return genStatic(s, n);
  return makeRound(s, n, matches as Match[], active);
}

function winStreak(s: Session, court: number, team: string[]): number {
  let streak = 0;
  for (let i = s.rounds.length - 1; i >= 0; i--) {
    const m = s.rounds[i].matches.find((x) => x.court === court);
    if (!m || m.status !== 'done') break;
    const w = matchScore(s, m).winner;
    const wt = w === 'a' ? m.a : w === 'b' ? m.b : null;
    if (wt && wt.length === team.length && team.every((id) => wt.includes(id))) streak++;
    else break;
  }
  return streak;
}

function genWinnerStays(s: Session, n: number): Round | null {
  const prev = s.rounds.at(-1);
  if (!prev) return genStatic(s, n);
  const active = activePlayers(s).map((p) => p.id);
  const h = history(s.rounds);
  const stays = new Map<number, string[]>();
  for (const m of prev.matches) {
    const w = matchScore(s, m).winner;
    if (w !== 'a' && w !== 'b') continue;
    const team = w === 'a' ? m.a : m.b;
    if (!team.every((id) => active.includes(id))) continue;
    if (winStreak(s, m.court, team) < s.settings.maxWinStreak) stays.set(m.court, team);
  }
  const staying = new Set([...stays.values()].flat());
  const queue = byFairness(active.filter((id) => !staying.has(id)), h);
  const lv = (id: string) => s.players.find((p) => p.id === id)?.level ?? 1;
  const matches: Match[] = [];
  for (let c = 0; c < s.courts; c++) {
    const stay = stays.get(c);
    if (stay) {
      if (queue.length < s.teamSize) continue;
      matches.push(newMatch(c, stay, queue.splice(0, s.teamSize)));
    } else {
      if (queue.length < s.teamSize * 2) continue;
      const g = queue.splice(0, s.teamSize * 2);
      if (s.teamSize === 1) matches.push(newMatch(c, [g[0]], [g[1]]));
      else {
        const sorted = g.slice().sort((x, y) => lv(y) - lv(x));
        matches.push(newMatch(c, [sorted[0], sorted[3]], [sorted[1], sorted[2]]));
      }
    }
  }
  if (!matches.length) return null;
  return makeRound(s, n, matches, active);
}

/* ------------------------------------------------------------------ */
/* Bracket: knockout & grup                                            */
/* ------------------------------------------------------------------ */

const nextPow2 = (x: number) => 2 ** Math.ceil(Math.log2(Math.max(2, x)));

function stageName(size: number): string {
  if (size === 2) return 'Final';
  if (size === 4) return 'Semifinal';
  if (size === 8) return 'Perempat final';
  return `Babak ${size} besar`;
}

/** Urutan seed standar: 1 vs terakhir, 2 vs kedua terakhir, dst. Bye untuk seed teratas. */
function seededPairs(ids: string[]): BracketMatch[] {
  const size = nextPow2(ids.length);
  const stage = stageName(size);
  const out: BracketMatch[] = [];
  for (let i = 0; i < size / 2; i++) {
    const a = ids[i] ?? null;
    const b = ids[size - 1 - i] ?? null;
    out.push({ id: uid(8), stage, unitA: a, unitB: b, winner: b === null ? (a ?? undefined) : undefined });
  }
  return out;
}

function seedUnits(s: Session) {
  const units = unitsOf(s);
  const lv = (id: string) => s.players.find((p) => p.id === id)?.level ?? 1;
  return units.slice().sort((x, y) => y.members.reduce((a, id) => a + lv(id), 0) - x.members.reduce((a, id) => a + lv(id), 0));
}

export function initBracket(s: Session): void {
  const units = seedUnits(s);
  if (units.length < 2) {
    s.bracket = undefined;
    return;
  }
  if (s.format === 'knockout') {
    s.bracket = { phase: 'knockout', groups: [], matches: seededPairs(units.map((u) => u.id)) };
    return;
  }
  const g = Math.max(1, Math.min(s.settings.groups, Math.floor(units.length / 2)));
  const groups: string[][] = Array.from({ length: g }, () => []);
  units.forEach((u, i) => {
    const row = Math.floor(i / g);
    const col = row % 2 === 0 ? i % g : g - 1 - (i % g);
    groups[col].push(u.id);
  });
  const matches: BracketMatch[] = [];
  groups.forEach((ids, gi) => {
    const stage = `Grup ${String.fromCharCode(65 + gi)}`;
    // Metode lingkaran: setiap pasangan bertemu sekali.
    const list = ids.length % 2 ? [...ids, null] : ids.slice();
    const rounds = list.length - 1;
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < list.length / 2; i++) {
        const a = list[i];
        const b = list[list.length - 1 - i];
        if (a && b) matches.push({ id: uid(8), stage, unitA: a, unitB: b });
      }
      list.splice(1, 0, list.pop()!);
    }
  });
  s.bracket = { phase: 'group', groups, matches };
}

function groupTable(s: Session, ids: string[]) {
  const stats = new Map(ids.map((id) => [id, { id, won: 0, diff: 0, pf: 0 }]));
  for (const bm of s.bracket?.matches ?? []) {
    if (!bm.matchId || !bm.unitA || !bm.unitB || !ids.includes(bm.unitA)) continue;
    const m = s.rounds.flatMap((r) => r.matches).find((x) => x.id === bm.matchId);
    if (!m || m.status !== 'done') continue;
    const sc = matchScore(s, m);
    const A = stats.get(bm.unitA)!;
    const B = stats.get(bm.unitB)!;
    A.pf += sc.statA;
    B.pf += sc.statB;
    A.diff += sc.statA - sc.statB;
    B.diff += sc.statB - sc.statA;
    if (sc.winner === 'a') A.won++;
    if (sc.winner === 'b') B.won++;
  }
  return [...stats.values()].sort((x, y) => y.won - x.won || y.diff - x.diff || y.pf - x.pf);
}

export function groupTables(s: Session) {
  return (s.bracket?.groups ?? []).map((ids, i) => ({ name: `Grup ${String.fromCharCode(65 + i)}`, rows: groupTable(s, ids) }));
}

/** Catat pemenang match bracket yang selesai dan buat babak berikutnya jika babak saat ini tuntas. */
export function advanceBracket(s: Session): void {
  const b = s.bracket;
  if (!b) return;
  const all = s.rounds.flatMap((r) => r.matches);
  for (const bm of b.matches) {
    if (bm.winner || !bm.matchId) continue;
    const m = all.find((x) => x.id === bm.matchId);
    if (m?.status === 'done') {
      const w = matchScore(s, m).winner;
      if (w === 'a' || w === 'b') bm.winner = w === 'a' ? bm.unitA! : bm.unitB!;
    }
  }
  if (b.phase === 'group') {
    if (b.matches.some((m) => !m.winner && !(m.matchId && all.find((x) => x.id === m.matchId)?.status === 'done'))) return;
    const tables = groupTables(s);
    const firsts = tables.map((t) => t.rows[0]?.id).filter(Boolean) as string[];
    const seconds = tables.map((t) => t.rows[1]?.id).filter(Boolean) as string[];
    const thirds = tables.length === 1 ? tables[0].rows.slice(2, 4).map((r) => r.id) : [];
    const q = [...firsts, ...seconds, ...thirds];
    if (q.length < 2) return;
    b.phase = 'knockout';
    b.matches.push(...seededPairs(q));
    return;
  }
  const ko = b.matches.filter((m) => !m.stage.startsWith('Grup') && m.stage !== 'Perebutan juara 3');
  const lastStage = ko.at(-1)?.stage;
  if (!lastStage) return;
  const current = ko.filter((m) => m.stage === lastStage);
  if (current.some((m) => !m.winner)) return;
  if (current.length === 1) return; // final selesai
  const winners = current.map((m) => m.winner!);
  const stage = stageName(winners.length);
  for (let i = 0; i < winners.length; i += 2) b.matches.push({ id: uid(8), stage, unitA: winners[i], unitB: winners[i + 1] });
  if (lastStage === 'Semifinal' && s.settings.thirdPlace) {
    const losers = current.map((m) => (m.winner === m.unitA ? m.unitB : m.unitA)).filter(Boolean) as string[];
    if (losers.length === 2) b.matches.push({ id: uid(8), stage: 'Perebutan juara 3', unitA: losers[0], unitB: losers[1] });
  }
}

function genBracket(s: Session, n: number): Round | null {
  if (!s.bracket) initBracket(s);
  const b = s.bracket;
  if (!b) return null;
  advanceBracket(s);
  const units = new Map(unitsOf(s).map((u) => [u.id, u]));
  const busy = new Set<string>();
  const matches: Match[] = [];
  for (const bm of b.matches) {
    if (matches.length >= s.courts) break;
    if (bm.matchId || bm.winner || !bm.unitA || !bm.unitB) continue;
    if (busy.has(bm.unitA) || busy.has(bm.unitB)) continue;
    const ua = units.get(bm.unitA);
    const ub = units.get(bm.unitB);
    if (!ua || !ub) continue;
    const m = newMatch(matches.length, ua.members, ub.members, { stage: bm.stage, unitA: ua.id, unitB: ub.id });
    bm.matchId = m.id;
    busy.add(ua.id).add(ub.id);
    matches.push(m);
  }
  if (!matches.length) return null;
  return makeRound(s, n, matches, activePlayers(s).map((p) => p.id));
}

/* ------------------------------------------------------------------ */
/* API publik mesin                                                    */
/* ------------------------------------------------------------------ */

export function generateRound(s: Session): Round | null {
  const n = (s.rounds.at(-1)?.n ?? 0) + 1;
  switch (s.format) {
    case 'mexicano':
    case 'mixicano':
      return genMexicano(s, n);
    case 'team_americano':
    case 'team_mexicano':
      return genTeams(s, n);
    case 'koth':
      return genKoth(s, n);
    case 'winner_stays':
      return genWinnerStays(s, n);
    case 'knockout':
    case 'group_ko':
      return genBracket(s, n);
    case 'custom':
      return null;
    default:
      return genStatic(s, n);
  }
}

export const roundDone = (r: Round) => r.matches.length > 0 && r.matches.every((m) => m.status === 'done');
const untouched = (r: Round) => !r.locked && r.matches.every((m) => m.status === 'scheduled' && m.events.length === 0 && !m.final);

export function currentRound(s: Session): Round | undefined {
  return s.rounds.find((r) => !roundDone(r));
}

/** Pastikan ronde cukup: format statis menyimpan `lookahead` ronde ke depan, format dinamis 1 ronde berjalan. */
function fillRounds(s: Session): void {
  const info = formatInfo(s.format);
  if (info.bracket) advanceBracket(s);
  const pending = () => s.rounds.filter((r) => !roundDone(r)).length;
  const want = info.dynamic && !info.bracket ? 1 : Math.max(1, s.settings.lookahead);
  let guard = 0;
  while (pending() < want && guard++ < 50) {
    if (info.dynamic && !info.bracket && pending() > 0) break;
    const r = generateRound(s);
    if (!r) break;
    s.rounds.push(r);
    if (info.bracket) advanceBracket(s);
  }
}

export function ensureRounds(s: Session): void {
  if (s.status !== 'running') return;
  fillRounds(s);
  dispatchCourts(s);
}

/** Buang ronde mendatang yang belum disentuh dan susun ulang (misal setelah daftar pemain berubah). */
export function regenerateFuture(s: Session): void {
  if (s.status !== 'running') return;
  const keep: Round[] = [];
  for (const r of s.rounds) {
    if (!roundDone(r) && untouched(r)) {
      if (s.bracket) for (const m of r.matches) {
        const bm = s.bracket.matches.find((x) => x.matchId === m.id);
        if (bm) bm.matchId = undefined;
      }
      continue;
    }
    keep.push(r);
  }
  keep.forEach((r, i) => (r.n = i + 1));
  s.rounds = keep;
  if (formatInfo(s.format).bracket && s.bracket && s.rounds.length === 0) initBracket(s);
  ensureRounds(s);
}

/* ------------------------------------------------------------------ */
/* Alur per lapangan: lapangan yang selesai langsung lanjut            */
/* ------------------------------------------------------------------ */

const roundOf = (s: Session, m: Match) => s.rounds.find((r) => r.matches.includes(m));

/** Pemain match ini yang masih terikat: punya match belum selesai di ronde sebelumnya, atau sedang main di lapangan lain. */
export function busyPlayers(s: Session, m: Match): string[] {
  const round = roundOf(s, m);
  if (!round) return [];
  const ids = new Set([...m.a, ...m.b]);
  const busy = new Set<string>();
  for (const r of s.rounds) {
    for (const x of r.matches) {
      if (x === m || x.status === 'done') continue;
      if (r.n < round.n || x.status === 'live' || x.events.length > 0)
        for (const id of [...x.a, ...x.b]) if (ids.has(id)) busy.add(id);
    }
  }
  return [...busy];
}

export interface CourtNow {
  court: number;
  match: Match;
  round: Round;
  /** Pemain yang masih main di tempat lain; match belum bisa dimulai. */
  blockedBy: string[];
}

/** Match yang sedang/akan dimainkan di lapangan ini: match belum selesai paling awal di lapangan itu. */
export function courtNow(s: Session, court: number): CourtNow | null {
  for (const r of s.rounds) {
    const m = r.matches.find((x) => x.court === court && x.status !== 'done');
    if (m) {
      const started = m.status === 'live' || m.events.length > 0;
      return { court, match: m, round: r, blockedBy: started ? [] : busyPlayers(s, m) };
    }
  }
  return null;
}

/**
 * Lapangan yang kosong mengambil match yang bisa langsung dimainkan.
 * Jika match berikutnya di lapangan ini terhalang, tukar lapangannya dengan match lain di ronde yang sama
 * yang semua pemainnya sudah bebas. Tidak melompati ronde, supaya giliran tetap adil.
 */
export function dispatchCourts(s: Session): void {
  if (s.status !== 'running') return;
  for (let c = 0; c < s.courts; c++) {
    const now = courtNow(s, c);
    if (!now || !now.blockedBy.length || now.round.locked) continue;
    const alt = now.round.matches.find(
      (x) =>
        x !== now.match &&
        x.status === 'scheduled' &&
        x.events.length === 0 &&
        !x.final &&
        busyPlayers(s, x).length === 0 &&
        // jangan ambil match yang lapangannya sendiri sudah siap memainkannya
        courtNow(s, x.court)?.match !== x,
    );
    if (alt) {
      [alt.court, now.match.court] = [now.match.court, alt.court];
      continue;
    }
    // Tidak ada yang bisa ditukar: format rotasi bebas menyusun ulang match berikutnya dari pemain yang sedang bebas.
    if (COURT_FLOW.includes(s.format) && freePlayers(s).length >= s.teamSize * 2) {
      const r = now.round;
      // Match yang belum disentuh di ronde ini & ronde sesudahnya disusun ulang; yang sudah dimulai tetap.
      r.matches = r.matches.filter((m) => m.status !== 'scheduled' || m.events.length > 0 || !!m.final);
      s.rounds = s.rounds.filter((x) => x === r ? x.matches.length > 0 : x.n < r.n || !untouched(x));
      s.rounds.forEach((x, i) => (x.n = i + 1));
      fillRounds(s);
    }
  }
}

/** Format yang susunannya tidak bergantung hasil, sehingga match berikutnya boleh disusun ulang per lapangan. */
const COURT_FLOW: FormatId[] = ['rotation', 'americano', 'guest_americano'];

/** Pemain sedang main: match yang sudah dimulai tapi belum selesai. */
function liveMatches(s: Session): Match[] {
  return s.rounds.flatMap((r) => r.matches).filter((m) => m.status !== 'done' && (m.status === 'live' || m.events.length > 0));
}

function freePlayers(s: Session): string[] {
  const busy = new Set(liveMatches(s).flatMap((m) => [...m.a, ...m.b]));
  return activePlayers(s)
    .map((p) => p.id)
    .filter((id) => !busy.has(id));
}

/**
 * Ronde berikutnya saat sebagian lapangan masih main: lapangan yang kosong hanya diisi pemain yang bebas,
 * pemain yang masih main dijadwalkan di lapangannya sendiri (mereka lanjut setelah selesai).
 * Hanya untuk ronde yang langsung berikutnya; ronde-ronde sesudahnya disusun normal.
 */
function genCourtAware(s: Session, n: number): Round | null {
  const live = liveMatches(s);
  if (!live.length || !COURT_FLOW.includes(s.format)) return null;
  const immediate = s.rounds.every((r) => r.matches.every((m) => m.status === 'done' || m.status === 'live' || m.events.length > 0));
  if (!immediate) return null;
  const active = activePlayers(s).map((p) => p.id);
  const h = history(s.rounds);
  const w = weightsFor(s);
  const per = s.teamSize * 2;
  const busyIds = new Set(live.flatMap((m) => [...m.a, ...m.b]));
  const busyCourts = [...new Set(live.map((m) => m.court))].filter((c) => c < s.courts).sort();
  const freeCourts = Array.from({ length: s.courts }, (_, c) => c).filter((c) => !busyCourts.includes(c));
  const free = byFairness(active.filter((id) => !busyIds.has(id)), h);
  const kFree = Math.min(freeCourts.length, Math.floor(free.length / per));
  const matches: Match[] = [];
  if (kFree > 0) {
    const ms = bestMatches(s, h, w, free.slice(0, kFree * per), kFree);
    ms.forEach((m, i) => matches.push(newMatch(freeCourts[i], m[0], m[1])));
  }
  const pool = byFairness([...free.slice(kFree * per), ...active.filter((id) => busyIds.has(id))], h);
  const kBusy = Math.min(busyCourts.length, Math.floor(pool.length / per));
  if (kBusy > 0) {
    const ms = bestMatches(s, h, w, pool.slice(0, kBusy * per), kBusy);
    ms.forEach((m, i) => matches.push(newMatch(busyCourts[i], m[0], m[1])));
  }
  if (!matches.length) return null;
  return makeRound(s, n, matches, active);
}

/** Ringkasan untuk pemain: kapan main berikutnya. */
export function nextAppearance(s: Session, playerId: string): { round: Round; match: Match; inRounds: number; blockedBy?: string[] } | null {
  const cur = currentRound(s);
  if (!cur) return null;
  // Sudah di lapangan (alur per lapangan bisa memajukan match ronde berikutnya).
  for (let c = 0; c < s.courts; c++) {
    const now = courtNow(s, c);
    if (now && (now.match.a.includes(playerId) || now.match.b.includes(playerId))) return { round: now.round, match: now.match, inRounds: 0, blockedBy: now.blockedBy };
  }
  const pending = s.rounds.filter((r) => r.n >= cur.n);
  for (const r of pending) {
    const m = r.matches.find((x) => x.status !== 'done' && (x.a.includes(playerId) || x.b.includes(playerId)));
    if (m) return { round: r, match: m, inRounds: r.n - cur.n };
  }
  return null;
}
