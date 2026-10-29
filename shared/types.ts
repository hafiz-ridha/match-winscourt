export type Sport = 'badminton' | 'padel';

export type FormatId =
  | 'rotation'
  | 'americano'
  | 'mexicano'
  | 'mix_americano'
  | 'mixicano'
  | 'team_americano'
  | 'team_mexicano'
  | 'koth'
  | 'winner_stays'
  | 'guest_americano'
  | 'club'
  | 'knockout'
  | 'group_ko'
  | 'custom';

export type Gender = 'M' | 'F';
export type Level = 1 | 2 | 3 | 4;
export type PlayerStatus = 'waitlist' | 'active' | 'rest' | 'late' | 'left';
export type Side = 'a' | 'b';

export interface Player {
  id: string;
  name: string;
  pinHash?: string;
  /** Dikirim ke publik sebagai pengganti pinHash: pemain sudah membuat PIN. */
  hasPin?: boolean;
  gender: Gender;
  level: Level;
  status: PlayerStatus;
  /** Pasangan tetap (format team / knockout ganda). Pemain dengan pair yang sama = satu tim. */
  pair?: string;
  club?: 'A' | 'B';
  guest?: boolean;
  joinedAt: number;
}

export type ScoreKind = 'rally' | 'points' | 'games' | 'sets';
export type DeuceMode = 'golden' | 'advantage' | 'star';

export interface ScoreRules {
  /** rally = badminton (target, selisih 2); points/games/sets = padel */
  kind: ScoreKind;
  /** rally: target poin. points: total poin per match (0 = bebas). */
  target: number;
  /** games: jumlah game (total) atau target game (race). */
  games: number;
  gamesMode: 'total' | 'race';
  deuce: DeuceMode;
  /** Padel poin langsung: ganti server tiap N poin. */
  serveEvery: number;
}

export interface FinalScore {
  a: number;
  b: number;
  /** Untuk tipe sets: skor game per set. */
  sets?: [number, number][];
}

export interface Match {
  id: string;
  court: number;
  a: string[];
  b: string[];
  events: Side[];
  final?: FinalScore;
  status: 'scheduled' | 'live' | 'done';
  /** Target poin khusus match ini (badminton, bisa diubah wasit). */
  target?: number;
  server?: Side;
  swapped?: boolean;
  stage?: string;
  /** Untuk knockout: id unit (pasangan/pemain). */
  unitA?: string;
  unitB?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface Round {
  n: number;
  matches: Match[];
  resting: string[];
  locked: boolean;
  manual?: boolean;
}

export interface SessionSettings {
  levelBalance: boolean;
  compensation: boolean;
  sortBy: 'points' | 'wins';
  hideLeaderboard: boolean;
  lookahead: number;
  kothBonus: boolean;
  maxWinStreak: number;
  groups: number;
  thirdPlace: boolean;
}

export interface BracketMatch {
  id: string;
  stage: string;
  unitA: string | null;
  unitB: string | null;
  /** Match yang sudah dijadwalkan ke ronde. */
  matchId?: string;
  winner?: string;
}

export interface Bracket {
  phase: 'group' | 'knockout';
  groups: string[][];
  matches: BracketMatch[];
}

export interface Session {
  id: string;
  slug: string;
  refKey: string;
  hostId: string;
  hostName: string;
  sport: Sport;
  format: FormatId;
  name: string;
  bookingId: string;
  start: string;
  end: string;
  courts: number;
  courtNames: string[];
  teamSize: 1 | 2;
  rules: ScoreRules;
  maxPlayers: number | null;
  settings: SessionSettings;
  players: Player[];
  rounds: Round[];
  bracket?: Bracket;
  status: 'draft' | 'running' | 'finished';
  /** Booking dibatalkan di Wins Court (terdeteksi saat sinkron). */
  bookingCancelled?: boolean;
  bookingSyncedAt?: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  version: number;
}

export interface Booking {
  id: string;
  name: string;
  phone: string;
  sport: Sport;
  courts: number[];
  start: string;
  end: string;
}

export interface Standing {
  id: string;
  name: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  pf: number;
  pa: number;
  bonus: number;
  comp: number;
  total: number;
  guest?: boolean;
  club?: 'A' | 'B';
}
