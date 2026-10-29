import type { FormatId, ScoreRules, SessionSettings, Sport } from './types.ts';

export interface FormatInfo {
  id: FormatId;
  name: string;
  desc: string;
  sports: Sport[];
  minCourts: number;
  /** Memakai pasangan tetap (unit = pasangan). */
  fixedPairs: boolean;
  /** Ronde berikutnya bergantung hasil ronde sebelumnya. */
  dynamic: boolean;
  mixed?: boolean;
  clubs?: boolean;
  bracket?: boolean;
  manual?: boolean;
}

/** Badminton: Mabar Bergilir, Americano, Knockout, Grup → Knockout. Format lain khusus padel.
 * KOTH butuh ≥ 2 lapangan sehingga tidak ditawarkan (padel hanya 1 lapangan). */
export const FORMATS: FormatInfo[] = [
  { id: 'rotation', name: 'Mabar Bergilir', desc: 'Yang paling lama menunggu main duluan. Pasangan & lawan diacak dengan level seimbang.', sports: ['badminton'], minCourts: 1, fixedPairs: false, dynamic: false },
  { id: 'americano', name: 'Americano', desc: 'Main dengan & melawan semua orang. Skor individu.', sports: ['badminton', 'padel'], minCourts: 1, fixedPairs: false, dynamic: false },
  { id: 'mexicano', name: 'Mexicano', desc: 'Ronde berikut disusun dari peringkat: 1+4 vs 2+3.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: true },
  { id: 'mix_americano', name: 'Mix Americano', desc: 'Tiap tim 1 putra + 1 putri. Partner berganti.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: false, mixed: true },
  { id: 'mixicano', name: 'Mixicano', desc: 'Mexicano dengan tim campuran putra + putri.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: true, mixed: true },
  { id: 'team_americano', name: 'Team Americano', desc: 'Pasangan tetap, melawan semua pasangan.', sports: ['padel'], minCourts: 1, fixedPairs: true, dynamic: false },
  { id: 'team_mexicano', name: 'Team Mexicano', desc: 'Pasangan tetap, lawan disusun dari peringkat.', sports: ['padel'], minCourts: 1, fixedPairs: true, dynamic: true },
  { id: 'koth', name: 'King of the Court', desc: 'Menang naik lapangan, kalah turun. Lapangan atas bernilai lebih.', sports: [], minCourts: 2, fixedPairs: false, dynamic: true },
  { id: 'winner_stays', name: 'Pemenang Bertahan', desc: 'Tim menang bertahan (maks. 2 kali), kalah masuk antrean.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: true },
  { id: 'guest_americano', name: 'Main dengan Tamu', desc: 'Americano dengan pemain bertanda Tamu.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: false },
  { id: 'club', name: 'Club vs Club', desc: 'Dua klub. Pasangan dari klub sendiri, skor dijumlah per klub.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: false, clubs: true },
  { id: 'knockout', name: 'Knockout', desc: 'Sistem gugur. Kalah langsung keluar.', sports: ['badminton', 'padel'], minCourts: 1, fixedPairs: true, dynamic: true, bracket: true },
  { id: 'group_ko', name: 'Grup → Knockout', desc: 'Round-robin per grup, 2 teratas lanjut ke gugur.', sports: ['badminton', 'padel'], minCourts: 1, fixedPairs: true, dynamic: true, bracket: true },
  { id: 'custom', name: 'Custom', desc: 'Susun ronde dan pasangan sendiri.', sports: ['padel'], minCourts: 1, fixedPairs: false, dynamic: true, manual: true },
];

export const formatInfo = (id: FormatId): FormatInfo => FORMATS.find((f) => f.id === id) ?? FORMATS[1];

export const formatsFor = (sport: Sport, courts: number): FormatInfo[] =>
  FORMATS.filter((f) => f.sports.includes(sport) && courts >= f.minCourts);

/** Nama lapangan sesuai nomor di Wins Court: badminton "Line 1"–"Line 4", padel "Padel". */
export const courtLabels = (sport: Sport, courts: number[]): string[] =>
  sport === 'padel' ? ['Padel'] : courts.slice(0, 4).map((c) => `Line ${c}`);

export const MAX_COURTS: Record<Sport, number> = { badminton: 4, padel: 1 };

export const defaultRules = (sport: Sport): ScoreRules =>
  sport === 'badminton'
    ? { kind: 'rally', target: 21, games: 6, gamesMode: 'total', deuce: 'golden', serveEvery: 4 }
    : { kind: 'points', target: 21, games: 6, gamesMode: 'total', deuce: 'golden', serveEvery: 4 };

export const defaultSettings = (): SessionSettings => ({
  levelBalance: true,
  compensation: true,
  sortBy: 'points',
  hideLeaderboard: false,
  lookahead: 4,
  kothBonus: true,
  maxWinStreak: 2,
  groups: 2,
  thirdPlace: false,
});

export const LEVELS = [
  { v: 1, name: 'Pemula' },
  { v: 2, name: 'Menengah' },
  { v: 3, name: 'Mahir' },
  { v: 4, name: 'Pro' },
] as const;

export const levelName = (l: number) => LEVELS.find((x) => x.v === l)?.name ?? 'Pemula';

export function rulesLabel(r: ScoreRules): string {
  if (r.kind === 'rally') return `Rally point · target ${r.target} · selisih 2`;
  if (r.kind === 'points') return r.target > 0 ? `Poin langsung · ${r.target} poin` : 'Poin langsung · bebas';
  const deuce = r.deuce === 'golden' ? 'golden point' : r.deuce === 'advantage' ? 'advantage' : 'star point';
  if (r.kind === 'games') return `${r.gamesMode === 'race' ? 'Race to' : 'Total'} ${r.games} game · ${deuce}`;
  return `Best of 3 set · ${deuce}`;
}
