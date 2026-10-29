import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { courtNow, currentRound, roundDone } from '../../shared/engine.ts';
import { formatInfo } from '../../shared/formats.ts';
import { matchScore, playerStandings } from '../../shared/standings.ts';
import { fmtDuration, fmtTime } from '../../shared/util.ts';
import { useLiveSession, useNow } from '../api.ts';
import { CourtArt } from '../components/CourtArt.tsx';
import { MatchCourt } from '../components/MatchCourt.tsx';
import { Loader } from '../components/ui.tsx';
import { courtName, shortCourt, teamNames } from './session/helpers.ts';

/** Papan skor untuk TV/proyektor di lounge Wins Court. */
export function TvBoard() {
  const { slug = '' } = useParams();
  const { session: s } = useLiveSession(slug);
  const now = useNow(1000);
  const [panel, setPanel] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPanel((p) => (p + 1) % 2), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!s) return <Loader />;
  const cur = currentRound(s);
  const nows = Array.from({ length: s.courts }, (_, c) => courtNow(s, c));
  const onCourt = new Set(nows.flatMap((n) => (n ? [n.match.id] : [])));
  const nextMatches = s.rounds
    .filter((r) => !roundDone(r))
    .flatMap((r) => r.matches.filter((m) => m.status !== 'done' && !onCourt.has(m.id)).map((m) => ({ m, n: r.n })))
    .slice(0, s.courts);
  const next = nextMatches.length ? { n: nextMatches[0].n, matches: nextMatches.map((x) => x.m) } : undefined;
  const top = playerStandings(s).slice(0, 5);
  const end = new Date(s.end).getTime();
  const over = now > end;
  const hide = s.settings.hideLeaderboard && s.status !== 'finished';

  return (
    <div className="tv">
      <div className="row-between">
        <div>
          <div className="eyebrow" style={{ color: 'var(--lime-deep)' }}>
            match.wins-court.com · {formatInfo(s.format).name}
          </div>
          <h1 style={{ fontSize: 48 }}>{s.name}</h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 40, fontWeight: 800, color: over ? 'var(--danger)' : 'var(--lime-deep)' }}>
            {over ? `+${fmtDuration(now - end)}` : fmtDuration(end - now)}
          </div>
          <div className="mute">{over ? `Jam main habis ${fmtTime(s.end)}` : `Jam main sampai ${fmtTime(s.end)}`}</div>
        </div>
      </div>

      {s.status === 'draft' && (
        <div className="court-card stack center" style={{ padding: 60 }}>
          <div style={{ width: "min(720px, 100%)", margin: "0 auto" }}><CourtArt sport={s.sport} teamSize={s.teamSize} players={false} glow /></div>
          <h2 style={{ fontSize: 36 }}>Sebentar lagi mulai</h2>
          <p className="mute">{s.players.filter((p) => p.status === 'active').length} pemain siap</p>
        </div>
      )}

      {cur && (
        <>
          <h2 style={{ fontSize: 28 }}>Di lapangan</h2>
          <div className="tv-grid">
            {nows.flatMap((n) => (n ? [n.match] : [])).map((m) => {
              const sc = matchScore(s, m);
              return (
                <div key={m.id} className={`court-card stack${m.status === 'live' ? ' live' : ''}`}>
                  <div className="row-between">
                    <b style={{ fontSize: 22 }}>{courtName(s, m.court)}</b>
                    <span className={`chip ${m.status === 'live' ? 'chip-lime' : ''}`}>{m.status === 'live' ? 'LIVE' : m.status === 'done' ? 'Selesai' : 'Siap'}</span>
                  </div>
                  {m.status !== 'done' && (
                    <MatchCourt s={s} m={m} />
                  )}
                  <div className="row-between" style={{ alignItems: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 600, maxWidth: '35%' }}>{teamNames(s, m.a)}</div>
                    <div className="tvscore">
                      {sc.a}
                      <span style={{ color: 'var(--whisper)' }}>:</span>
                      {sc.b}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 600, maxWidth: '35%', textAlign: 'right' }}>{teamNames(s, m.b)}</div>
                  </div>
                  {sc.gameA !== undefined && (
                    <div className="center num" style={{ fontSize: 28, color: 'var(--lime-deep)', fontWeight: 800 }}>
                      {sc.gameA} – {sc.gameB}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="tv-grid">
        {(panel === 0 || hide) && next && (
          <div className="court-card stack">
            <h2>Berikutnya</h2>
            {next.matches.map((m) => (
              <div key={m.id} style={{ fontSize: 22 }}>
                <span className="mute">{shortCourt(s, m.court)} </span>
                {teamNames(s, m.a)} <span className="mute">vs</span> {teamNames(s, m.b)}
              </div>
            ))}
          </div>
        )}
        {(panel === 1 || !next) && !hide && (
          <div className="court-card stack">
            <h2>5 besar</h2>
            {top.map((x, i) => (
              <div key={x.id} className="row-between" style={{ fontSize: 24 }}>
                <span>
                  <b className="num" style={{ color: i === 0 ? 'var(--lime-deep)' : 'var(--whisper)', marginRight: 12 }}>
                    {i + 1}
                  </b>
                  {x.name}
                </span>
                <b className="num">{x.total}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
