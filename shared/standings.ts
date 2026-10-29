import { formatInfo } from './formats.ts';
import { computeScore } from './scoring.ts';
import type { Match, Session, Standing } from './types.ts';

export const requiresWinner = (s: Session) => !!formatInfo(s.format).bracket;

export function matchScore(s: Session, m: Match) {
  return computeScore(m, s.rules, { requireWinner: requiresWinner(s) });
}

export function doneMatches(s: Session): Match[] {
  return s.rounds.flatMap((r) => r.matches).filter((m) => m.status === 'done');
}

function blank(id: string, name: string): Standing {
  return { id, name, played: 0, won: 0, draw: 0, lost: 0, pf: 0, pa: 0, bonus: 0, comp: 0, total: 0 };
}

function sortStandings(list: Standing[], by: 'points' | 'wins') {
  return list.sort((x, y) => {
    const k = by === 'wins' ? y.won - x.won : y.total - x.total;
    if (k) return k;
    if (y.won !== x.won) return y.won - x.won;
    const d = y.pf - y.pa - (x.pf - x.pa);
    if (d) return d;
    return y.pf - x.pf;
  });
}

/** Peringkat individu. total = poin dicetak + bonus KOTH + kompensasi (+M). */
export function playerStandings(s: Session): Standing[] {
  const map = new Map<string, Standing>();
  for (const p of s.players) {
    const st = blank(p.id, p.name);
    st.guest = p.guest;
    st.club = p.club;
    map.set(p.id, st);
  }
  const koth = s.format === 'koth' && s.settings.kothBonus;
  for (const m of doneMatches(s)) {
    const sc = matchScore(s, m);
    const apply = (ids: string[], pf: number, pa: number, res: 'w' | 'd' | 'l') => {
      for (const id of ids) {
        const st = map.get(id);
        if (!st) continue;
        st.played++;
        st.pf += pf;
        st.pa += pa;
        if (res === 'w') {
          st.won++;
          if (koth) st.bonus += s.courts - m.court;
        } else if (res === 'd') st.draw++;
        else st.lost++;
      }
    };
    const w = sc.winner;
    apply(m.a, sc.statA, sc.statB, w === 'a' ? 'w' : w === 'draw' ? 'd' : 'l');
    apply(m.b, sc.statB, sc.statA, w === 'b' ? 'w' : w === 'draw' ? 'd' : 'l');
  }
  const list = [...map.values()].filter((st) => st.played > 0 || s.players.find((p) => p.id === st.id)?.status !== 'waitlist');
  const maxPlayed = Math.max(0, ...list.map((x) => x.played));
  for (const st of list) {
    st.comp = s.settings.compensation && st.played > 0 ? Math.round((st.pf / st.played) * (maxPlayed - st.played)) : 0;
    st.total = st.pf + st.bonus + st.comp;
  }
  return sortStandings(list, s.settings.sortBy);
}

/** Unit = pasangan tetap (atau pemain untuk tunggal). */
export function unitsOf(s: Session): { id: string; members: string[]; name: string }[] {
  const active = s.players.filter((p) => p.status !== 'waitlist' && p.status !== 'left');
  if (s.teamSize === 1) return active.map((p) => ({ id: p.id, members: [p.id], name: p.name }));
  const byPair = new Map<string, string[]>();
  for (const p of active) {
    if (!p.pair) continue;
    byPair.set(p.pair, [...(byPair.get(p.pair) ?? []), p.id]);
  }
  const name = (ids: string[]) => ids.map((id) => s.players.find((p) => p.id === id)?.name ?? '?').join(' / ');
  return [...byPair.entries()].filter(([, m]) => m.length === 2).map(([id, members]) => ({ id, members, name: name(members) }));
}

export function teamStandings(s: Session): Standing[] {
  const units = unitsOf(s);
  const map = new Map(units.map((u) => [u.id, blank(u.id, u.name)]));
  const unitOf = (ids: string[]) => units.find((u) => ids.length && ids.every((id) => u.members.includes(id)))?.id;
  for (const m of doneMatches(s)) {
    const sc = matchScore(s, m);
    const ua = m.unitA ?? unitOf(m.a);
    const ub = m.unitB ?? unitOf(m.b);
    for (const [u, pf, pa, side] of [[ua, sc.statA, sc.statB, 'a'], [ub, sc.statB, sc.statA, 'b']] as const) {
      const st = u ? map.get(u) : undefined;
      if (!st) continue;
      st.played++;
      st.pf += pf;
      st.pa += pa;
      if (sc.winner === side) st.won++;
      else if (sc.winner === 'draw') st.draw++;
      else st.lost++;
    }
  }
  const list = [...map.values()];
  for (const st of list) st.total = st.pf;
  return sortStandings(list, s.settings.sortBy);
}

export function clubTotals(s: Session): { A: number; B: number; winsA: number; winsB: number } {
  const res = { A: 0, B: 0, winsA: 0, winsB: 0 };
  const clubOf = (id?: string) => s.players.find((p) => p.id === id)?.club;
  for (const m of doneMatches(s)) {
    const sc = matchScore(s, m);
    const ca = clubOf(m.a[0]);
    const cb = clubOf(m.b[0]);
    if (ca) res[ca] += sc.statA;
    if (cb) res[cb] += sc.statB;
    if (sc.winner === 'a' && ca) ca === 'A' ? res.winsA++ : res.winsB++;
    if (sc.winner === 'b' && cb) cb === 'A' ? res.winsA++ : res.winsB++;
  }
  return res;
}
