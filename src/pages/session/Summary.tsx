import { useMemo } from 'react';
import { formatInfo, isManualBooking, manualExpiry } from '../../../shared/formats.ts';
import { fmtDate } from '../../../shared/util.ts';
import { doneMatches, matchScore, playerStandings, teamStandings, unitsOf } from '../../../shared/standings.ts';
import { Download, Share, Trophy } from '../../components/Icons.tsx';
import { Confetti, useRun } from '../../components/ui.tsx';
import { exportCsv, shareImage, type Ctx } from './helpers.ts';
import { StandingsTable } from './RankTab.tsx';

export function Summary({ ctx }: { ctx: Ctx }) {
  const { s, isHost, playerId } = ctx;
  const { run, busy } = useRun();
  const info = formatInfo(s.format);
  const players = useMemo(() => playerStandings(s), [s]);
  const matches = doneMatches(s);
  const totalPoints = matches.reduce((a, m) => {
    const sc = matchScore(s, m);
    return a + sc.statA + sc.statB;
  }, 0);

  const champion = useMemo(() => {
    if (info.bracket) {
      const final = s.bracket?.matches.find((m) => m.stage === 'Final' && m.winner);
      if (final) return unitsOf(s).find((u) => u.id === final.winner)?.name ?? '—';
    }
    if (info.fixedPairs && s.teamSize === 2) return teamStandings(s)[0]?.name ?? '—';
    if (info.clubs) {
      const a = players.filter((p) => p.club === 'A').reduce((x, p) => x + p.pf, 0);
      const b = players.filter((p) => p.club === 'B').reduce((x, p) => x + p.pf, 0);
      return a === b ? 'Seri' : a > b ? 'Klub A' : 'Klub B';
    }
    return players[0]?.name ?? '—';
  }, [s, info, players]);

  const mvp = players.slice().sort((x, y) => y.total - x.total)[0];
  const busiest = players.slice().sort((x, y) => y.played - x.played)[0];
  const bestDiff = players.slice().sort((x, y) => y.pf - y.pa - (x.pf - x.pa))[0];

  return (
    <div className="stack-lg">
      <Confetti run />
      <div className="card hero stack center rise" style={{ background: 'var(--lime)', color: 'var(--on-lime)', borderColor: 'transparent' }}>
        <Trophy size={36} style={{ margin: '0 auto' }} />
        <div className="eyebrow" style={{ color: 'var(--on-lime)' }}>
          Juara sesi
        </div>
        <h1 style={{ fontSize: 34 }}>{champion}</h1>
        <p className="small">
          {matches.length} pertandingan · {totalPoints} {s.rules.kind === 'games' || s.rules.kind === 'sets' ? 'game' : 'poin'} dimainkan
        </p>
      </div>

      <div className="choice-grid">
        {mvp && (
          <div className="card card-tight rise" style={{ animationDelay: '80ms' }}>
            <div className="eyebrow">MVP</div>
            <b>{mvp.name}</b>
            <div className="tiny mute">{mvp.total} total poin</div>
          </div>
        )}
        {busiest && (
          <div className="card card-tight rise" style={{ animationDelay: '140ms' }}>
            <div className="eyebrow">Paling rajin</div>
            <b>{busiest.name}</b>
            <div className="tiny mute">{busiest.played} match</div>
          </div>
        )}
        {bestDiff && (
          <div className="card card-tight rise" style={{ animationDelay: '200ms' }}>
            <div className="eyebrow">Selisih terbaik</div>
            <b>{bestDiff.name}</b>
            <div className="tiny mute">
              {bestDiff.pf - bestDiff.pa >= 0 ? '+' : ''}
              {bestDiff.pf - bestDiff.pa}
            </div>
          </div>
        )}
        <div className="card card-tight rise" style={{ animationDelay: '260ms' }}>
          <div className="eyebrow">Format</div>
          <b>{info.name}</b>
          <div className="tiny mute">{s.rounds.length} ronde</div>
        </div>
      </div>

      <div className="row wrap no-print">
        <button className="btn btn-primary grow" disabled={busy} onClick={() => run(() => shareImage(s, champion))}>
          <Share size={18} /> Bagikan gambar
        </button>
        <button className="btn btn-ghost" onClick={() => window.print()}>
          PDF
        </button>
        {isHost && (
          <button className="btn btn-ghost" onClick={() => exportCsv(s)} aria-label="Unduh CSV">
            <Download size={18} /> CSV
          </button>
        )}
      </div>

      {isManualBooking(s.bookingId) && (
        <div className="banner banner-warn no-print">
          <span>
            Hasil sesi ini tersimpan sampai <b>{fmtDate(manualExpiry(s.end))}</b>. Unduh gambar, PDF, atau CSV untuk menyimpannya lebih lama.
          </span>
        </div>
      )}

      <StandingsTable list={players} mine={playerId} showComp={s.settings.compensation} title="Peringkat akhir" />
    </div>
  );
}
