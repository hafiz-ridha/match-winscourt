import type { Match, ScoreRules, Side } from './types.ts';

export interface ScoreState {
  /** Angka utama: poin (rally/points), game (games), set (sets). */
  a: number;
  b: number;
  /** Label poin game berjalan (games/sets): 0, 15, 30, 40, AD, atau angka tie-break. */
  gameA?: string;
  gameB?: string;
  /** Game di set berjalan (sets). */
  setGamesA?: number;
  setGamesB?: number;
  sets: [number, number][];
  tiebreak?: boolean;
  done: boolean;
  winner: Side | 'draw' | null;
  /** Nilai yang masuk peringkat: poin (rally/points) atau game (games/sets). */
  statA: number;
  statB: number;
  /** Sisi yang tinggal 1 poin untuk menang. */
  matchPoint: Side | null;
  target: number;
}

const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');
const LABELS = ['0', '15', '30', '40'];

/** Hitung status skor dari urutan event poin (atau skor akhir yang diinput manual). */
export function computeScore(m: Match, r: ScoreRules, opts: { requireWinner?: boolean } = {}): ScoreState {
  const requireWinner = !!opts.requireWinner;
  if (r.kind === 'rally') return rally(m, r);
  if (r.kind === 'points') return points(m, r, requireWinner);
  if (r.kind === 'games') return games(m, r, requireWinner);
  return sets(m, r);
}

function rally(m: Match, r: ScoreRules): ScoreState {
  const target = m.target ?? r.target;
  let a = 0;
  let b = 0;
  if (m.final) {
    a = m.final.a;
    b = m.final.b;
  } else for (const e of m.events) e === 'a' ? a++ : b++;
  const done = m.final ? true : Math.max(a, b) >= target && Math.abs(a - b) >= 2;
  const winner = done ? (a > b ? 'a' : b > a ? 'b' : 'draw') : null;
  let matchPoint: Side | null = null;
  if (!done) {
    if (a + 1 >= target && a + 1 - b >= 2) matchPoint = 'a';
    else if (b + 1 >= target && b + 1 - a >= 2) matchPoint = 'b';
  }
  return { a, b, sets: [], done, winner, statA: a, statB: b, matchPoint, target };
}

function points(m: Match, r: ScoreRules, requireWinner: boolean): ScoreState {
  let a = 0;
  let b = 0;
  if (m.final) {
    a = m.final.a;
    b = m.final.b;
  } else for (const e of m.events) e === 'a' ? a++ : b++;
  const target = r.target;
  let done = m.final ? true : target > 0 && a + b >= target;
  if (done && requireWinner && a === b && !m.final) done = false;
  const winner = done ? (a > b ? 'a' : b > a ? 'b' : 'draw') : null;
  const matchPoint: Side | null = !done && target > 0 && a + b === target - 1 ? (a > b ? 'a' : b > a ? 'b' : null) : null;
  return { a, b, sets: [], done, winner, statA: a, statB: b, matchPoint, target };
}

/** Satu game padel/tenis dengan aturan deuce. Mengembalikan pemenang game jika selesai. */
function gamePoint(pa: number, pb: number, side: Side, deuce: ScoreRules['deuce']): { pa: number; pb: number; won: Side | null } {
  if (pa === pb && pa >= 3) {
    const deuceCount = pa - 2;
    if (deuce === 'golden' || (deuce === 'star' && deuceCount >= 3)) return { pa: 0, pb: 0, won: side };
  }
  if (side === 'a') pa++;
  else pb++;
  const lead = side === 'a' ? pa - pb : pb - pa;
  const mine = side === 'a' ? pa : pb;
  if (mine >= 4 && lead >= 2) return { pa: 0, pb: 0, won: side };
  return { pa, pb, won: null };
}

function gameLabels(pa: number, pb: number): [string, string] {
  if (pa >= 3 && pb >= 3) {
    if (pa === pb) return ['40', '40'];
    return pa > pb ? ['AD', '40'] : ['40', 'AD'];
  }
  return [LABELS[Math.min(pa, 3)], LABELS[Math.min(pb, 3)]];
}

function games(m: Match, r: ScoreRules, requireWinner: boolean): ScoreState {
  const isDone = (ga: number, gb: number) => {
    if (r.gamesMode === 'race') return Math.max(ga, gb) >= r.games;
    if (ga + gb < r.games) return false;
    return !(requireWinner && ga === gb);
  };
  if (m.final) {
    const { a, b } = m.final;
    return { a, b, sets: [], done: true, winner: a > b ? 'a' : b > a ? 'b' : 'draw', statA: a, statB: b, matchPoint: null, target: r.games };
  }
  let ga = 0;
  let gb = 0;
  let pa = 0;
  let pb = 0;
  for (const e of m.events) {
    if (isDone(ga, gb)) break;
    const res = gamePoint(pa, pb, e, r.deuce);
    pa = res.pa;
    pb = res.pb;
    if (res.won === 'a') ga++;
    else if (res.won === 'b') gb++;
  }
  const done = isDone(ga, gb);
  const [gameA, gameB] = gameLabels(pa, pb);
  return {
    a: ga,
    b: gb,
    gameA: done ? undefined : gameA,
    gameB: done ? undefined : gameB,
    sets: [],
    done,
    winner: done ? (ga > gb ? 'a' : gb > ga ? 'b' : 'draw') : null,
    statA: ga,
    statB: gb,
    matchPoint: null,
    target: r.games,
  };
}

function sets(m: Match, r: ScoreRules): ScoreState {
  if (m.final) {
    const list = m.final.sets ?? [];
    let sa = 0;
    let sb = 0;
    let ga = 0;
    let gb = 0;
    for (const [x, y] of list) {
      if (x > y) sa++;
      else if (y > x) sb++;
      ga += x;
      gb += y;
    }
    return { a: sa, b: sb, sets: list, done: true, winner: sa > sb ? 'a' : sb > sa ? 'b' : 'draw', statA: ga, statB: gb, matchPoint: null, target: 2 };
  }
  const done: [number, number][] = [];
  let sa = 0;
  let sb = 0;
  let ga = 0;
  let gb = 0;
  let pa = 0;
  let pb = 0;
  let totalA = 0;
  let totalB = 0;
  const superTb = () => sa === 1 && sb === 1;
  const inTb = () => superTb() || (ga === 6 && gb === 6);
  for (const e of m.events) {
    if (sa === 2 || sb === 2) break;
    if (inTb()) {
      const need = superTb() ? 10 : 7;
      if (e === 'a') pa++;
      else pb++;
      const lead = Math.abs(pa - pb);
      if ((pa >= need || pb >= need) && lead >= 2) {
        const w: Side = pa > pb ? 'a' : 'b';
        if (superTb()) {
          done.push(w === 'a' ? [1, 0] : [0, 1]);
          w === 'a' ? totalA++ : totalB++;
        } else {
          w === 'a' ? ga++ : gb++;
          w === 'a' ? totalA++ : totalB++;
          done.push([ga, gb]);
        }
        w === 'a' ? sa++ : sb++;
        ga = gb = pa = pb = 0;
      }
      continue;
    }
    const res = gamePoint(pa, pb, e, r.deuce);
    pa = res.pa;
    pb = res.pb;
    if (res.won) {
      res.won === 'a' ? (ga++, totalA++) : (gb++, totalB++);
      const lead = Math.abs(ga - gb);
      if ((ga >= 6 || gb >= 6) && lead >= 2) {
        done.push([ga, gb]);
        ga > gb ? sa++ : sb++;
        ga = gb = 0;
      }
    }
  }
  const finished = sa === 2 || sb === 2;
  const tb = !finished && inTb();
  const [gameA, gameB] = tb ? [String(pa), String(pb)] : gameLabels(pa, pb);
  return {
    a: sa,
    b: sb,
    gameA: finished ? undefined : gameA,
    gameB: finished ? undefined : gameB,
    setGamesA: ga,
    setGamesB: gb,
    sets: done,
    tiebreak: tb,
    done: finished,
    winner: finished ? (sa > sb ? 'a' : 'b') : null,
    statA: totalA,
    statB: totalB,
    matchPoint: null,
    target: 2,
  };
}

/** Siapa yang servis untuk padel poin langsung: bergantian tiap N poin. */
export function autoServer(m: Match, r: ScoreRules): Side {
  const start: Side = m.server ?? 'a';
  if (r.kind !== 'points') return start;
  const n = Math.max(1, r.serveEvery);
  const block = Math.floor(m.events.length / n);
  return block % 2 === 0 ? start : other(start);
}

export function scoreSummary(st: ScoreState, r: ScoreRules): string {
  if (r.kind === 'sets') {
    const parts = st.sets.map(([x, y]) => `${x}-${y}`);
    if (!st.done && (st.setGamesA || st.setGamesB)) parts.push(`${st.setGamesA}-${st.setGamesB}`);
    return parts.join(', ') || '0-0';
  }
  return `${st.a}-${st.b}`;
}
