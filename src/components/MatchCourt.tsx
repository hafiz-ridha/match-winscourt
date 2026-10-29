import { autoServer } from '../../shared/scoring.ts';
import { matchScore } from '../../shared/standings.ts';
import type { Match, Session, Side } from '../../shared/types.ts';
import { CourtArt } from './CourtArt.tsx';

/**
 * Lapangan untuk satu match di ronde aktif. Semua data diambil dari match itu sendiri:
 * pemain + level, sisi (ikut "Tukar sisi" wasit), server & posisinya, skor, status, dan pemenang.
 */
export function MatchCourt({ s, m, glow }: { s: Session; m: Match; glow?: boolean }) {
  const sc = matchScore(s, m);
  const player = (id: string) => {
    const p = s.players.find((x) => x.id === id);
    return { name: p?.name ?? '?', level: p?.level };
  };
  const server: Side = s.rules.kind === 'points' ? autoServer(m, s.rules) : (m.server ?? 'a');
  // Poin tim server menentukan servis dari kanan (genap) atau kiri (ganjil).
  const serverPoints = s.rules.kind === 'rally' || s.rules.kind === 'points' ? (server === 'a' ? sc.a : sc.b) : m.events.filter((e) => e === server).length;
  const started = m.status !== 'scheduled' || m.events.length > 0 || !!m.final;
  return (
    <CourtArt
      sport={s.sport}
      teamSize={s.teamSize}
      a={m.a.map(player)}
      b={m.b.map(player)}
      state={m.status === 'done' ? 'done' : started ? 'live' : 'scheduled'}
      score={started ? { a: sc.a, b: sc.b } : null}
      server={server}
      serverPoints={serverPoints}
      swapped={!!m.swapped}
      winner={m.status === 'done' ? sc.winner : null}
      glow={glow}
    />
  );
}
