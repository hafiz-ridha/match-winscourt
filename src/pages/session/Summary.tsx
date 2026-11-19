import { useMemo } from 'react';
import { formatInfo, isManualBooking, manualExpiry } from '../../../shared/formats.ts';
import { fmtDate } from '../../../shared/util.ts';
import type { Session } from '../../../shared/types.ts';
import { doneMatches, matchScore, playerStandings } from '../../../shared/standings.ts';
import { Download, Share, Trophy } from '../../components/Icons.tsx';
import { Medal } from '../../components/Medal.tsx';
import { Confetti, useRun } from '../../components/ui.tsx';
import { exportCsv, shareImage, type Ctx } from './helpers.ts';
import { championText, podiumOf, type Podium as PodiumData, type PodiumEntry } from './podium.ts';
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

  const podium = useMemo(() => podiumOf(s), [s]);

  const mvp = players.slice().sort((x, y) => y.total - x.total)[0];
  const busiest = players.slice().sort((x, y) => y.played - x.played)[0];
  const bestDiff = players.slice().sort((x, y) => y.pf - y.pa - (x.pf - x.pa))[0];

  return (
    <div className="stack-lg">
      <Confetti run />
      <PodiumCard s={s} podium={podium} meta={`${matches.length} pertandingan · ${totalPoints} ${s.rules.kind === 'games' || s.rules.kind === 'sets' ? 'game' : 'poin'} dimainkan`} />

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
        <button className="btn btn-primary grow" disabled={busy} onClick={() => run(() => shareImage(s))}>
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

/** Kartu juara sesi: tangga podium 2 – 1 – 3 dengan medali emas, perak, perunggu. */
function PodiumCard({ s, podium, meta }: { s: Session; podium: PodiumData; meta: string }) {
  const byRank = (r: 1 | 2 | 3) => podium.list.find((x) => x.rank === r);
  const order = ([2, 1, 3] as const).map(byRank);
  const club = podium.club;
  return (
    <section className="podium-card rise" aria-label="Juara sesi">
      <div className="podium-head">
        <span className="podium-trophy" aria-hidden>
          <Trophy size={22} />
        </span>
        <div>
          <div className="podium-eyebrow">{club ? 'Club vs Club · ' : ''}Juara sesi</div>
          <h2 className="podium-title">{club ? (club.winner ? `Klub ${club.winner} menang` : 'Hasil seri') : s.name}</h2>
          <p className="podium-meta">{club ? `Klub A ${club.a} – ${club.b} Klub B · ${meta}` : meta}</p>
        </div>
      </div>
      {podium.list.length === 0 ? (
        <p className="podium-empty">Belum ada pertandingan selesai.</p>
      ) : (
        <ol className={`podium${podium.list.length < 3 ? ' podium-few' : ''}`} aria-label={`Juara: ${championText(podium)}`}>
          {order.map((e, i) => (e ? <PodiumStep key={e.rank} e={e} /> : <li key={`empty${i}`} className="podium-col empty" aria-hidden />))}
        </ol>
      )}
    </section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

function PodiumStep({ e }: { e: PodiumEntry }) {
  const label = e.rank === 1 ? 'Juara 1' : e.rank === 2 ? 'Juara 2' : e.names.length > 1 ? 'Juara 3 bersama' : 'Juara 3';
  return (
    <li className={`podium-col r${e.rank}`} value={e.rank}>
      <div className="podium-person">
        <div className="podium-avatar">
          <span>{e.names.length > 1 ? '3' : initials(e.names[0])}</span>
          <span className="podium-medal">
            <Medal rank={e.rank} size={e.rank === 1 ? 34 : 28} />
          </span>
        </div>
        <span className="podium-rank">{label}</span>
        <b className="podium-name" title={e.names.join(' · ')}>
          {e.names.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </b>
        <span className="podium-stat">{e.stat}</span>
      </div>
      <div className="podium-step" aria-hidden>
        <span>{e.rank}</span>
      </div>
    </li>
  );
}
