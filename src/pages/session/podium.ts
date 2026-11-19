/** Juara 1–3 sesi untuk podium (halaman ringkasan & gambar yang dibagikan). */
import { formatInfo } from '../../../shared/formats.ts';
import { playerStandings, teamStandings, unitsOf } from '../../../shared/standings.ts';
import type { Session, Standing } from '../../../shared/types.ts';

export interface PodiumEntry {
  rank: 1 | 2 | 3;
  /** Satu nama, atau dua untuk juara 3 bersama (semifinalis tanpa perebutan juara 3). */
  names: string[];
  /** Keterangan singkat: poin/menang, atau babak di turnamen. */
  stat: string;
}

export interface Podium {
  /** Pemain, tim tetap, atau unit turnamen. */
  kind: 'player' | 'team';
  list: PodiumEntry[];
  /** Club vs Club: klub pemenang. */
  club?: { winner: 'A' | 'B' | null; a: number; b: number };
}

const statOf = (s: Session, x: Standing) => {
  const diff = x.pf - x.pa;
  const d = `${diff >= 0 ? '+' : ''}${diff}`;
  return s.settings.sortBy === 'wins' ? `${x.won} menang · selisih ${d}` : `${x.total} poin · ${x.won} menang`;
};

const fromStandings = (s: Session, rows: Standing[]): PodiumEntry[] =>
  rows
    .filter((x) => x.played > 0)
    .slice(0, 3)
    .map((x, i) => ({ rank: (i + 1) as 1 | 2 | 3, names: [x.name], stat: statOf(s, x) }));

export function podiumOf(s: Session): Podium {
  const info = formatInfo(s.format);
  const teams = s.teamSize === 2 && (info.fixedPairs || info.bracket);

  // Turnamen: juara = pemenang final, juara 2 = finalis, juara 3 = pemenang perebutan juara 3
  // (atau kedua semifinalis bila tidak ada perebutan juara 3).
  if (info.bracket && s.bracket) {
    const name = (id: string | null | undefined) => (id ? (unitsOf(s).find((u) => u.id === id)?.name ?? '—') : '—');
    const ms = s.bracket.matches;
    const final = ms.find((m) => m.stage === 'Final' && m.winner);
    if (final) {
      const runnerUp = final.winner === final.unitA ? final.unitB : final.unitA;
      const list: PodiumEntry[] = [
        { rank: 1, names: [name(final.winner)], stat: 'Juara turnamen' },
        { rank: 2, names: [name(runnerUp)], stat: 'Finalis' },
      ];
      const third = ms.find((m) => m.stage === 'Perebutan juara 3' && m.winner);
      if (third) list.push({ rank: 3, names: [name(third.winner)], stat: 'Menang perebutan juara 3' });
      else {
        const semiLosers = ms
          .filter((m) => m.stage === 'Semifinal' && m.winner && m.unitA && m.unitB)
          .map((m) => (m.winner === m.unitA ? m.unitB : m.unitA));
        if (semiLosers.length) list.push({ rank: 3, names: semiLosers.map(name), stat: 'Semifinalis' });
      }
      return { kind: teams ? 'team' : 'player', list };
    }
  }

  const players = playerStandings(s);
  if (info.clubs) {
    const a = players.filter((p) => p.club === 'A').reduce((x, p) => x + p.pf, 0);
    const b = players.filter((p) => p.club === 'B').reduce((x, p) => x + p.pf, 0);
    return { kind: 'player', list: fromStandings(s, players), club: { winner: a === b ? null : a > b ? 'A' : 'B', a, b } };
  }
  if (info.fixedPairs && s.teamSize === 2) return { kind: 'team', list: fromStandings(s, teamStandings(s)) };
  return { kind: 'player', list: fromStandings(s, players) };
}

/** Teks juara untuk judul/teks bagikan. */
export function championText(p: Podium) {
  if (p.club) return p.club.winner ? `Klub ${p.club.winner}` : 'Seri';
  return p.list[0]?.names.join(' & ') ?? '—';
}
