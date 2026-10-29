import { useState } from 'react';
import { Link } from 'react-router-dom';
import { matchScore, requiresWinner } from '../../../shared/standings.ts';
import type { Match, Session } from '../../../shared/types.ts';
import { MatchCourt } from '../../components/MatchCourt.tsx';
import { Edit, Whistle } from '../../components/Icons.tsx';
import { Sheet, useRun } from '../../components/ui.tsx';
import { courtName, isMine, nameOf, type Ctx } from './helpers.ts';

export function MatchCard({ ctx, m, compact, roundN, blockedBy = [] }: { ctx: Ctx; m: Match; compact?: boolean; roundN?: number; blockedBy?: string[] }) {
  const { s, playerId, isHost, canScore } = ctx;
  const sc = matchScore(s, m);
  const [quick, setQuick] = useState(false);
  const [edit, setEdit] = useState(false);
  const { run, busy } = useRun();
  const started = m.status !== 'scheduled' || m.events.length > 0;
  const winA = m.status === 'done' && sc.winner === 'a';
  const winB = m.status === 'done' && sc.winner === 'b';

  const localHref = `/wasit-lokal?sport=${s.sport}&a=${encodeURIComponent(m.a.map((id) => nameOf(s, id)).join(' & '))}&b=${encodeURIComponent(
    m.b.map((id) => nameOf(s, id)).join(' & '),
  )}&kind=${s.rules.kind}&target=${m.target ?? s.rules.target}`;

  return (
    <div className={`match rise${m.status === 'done' ? ' done' : ''}${m.status === 'live' ? ' live' : ''}${isMine(m, playerId) ? ' me' : ''}`}>
      <div className="row-between">
        <span className="row" style={{ gap: 6 }}>
          <b className="small">{courtName(s, m.court)}</b>
          {roundN !== undefined && <span className="chip tiny">Ronde {roundN}</span>}
          {m.stage && <span className="chip tiny">{m.stage}</span>}
        </span>
        <span className={`chip tiny ${m.status === 'live' ? 'chip-danger' : m.status === 'done' ? '' : 'chip-outline'}`}>
          {m.status === 'live' && <span className="dot dot-live" />}
          {m.status === 'live' ? 'Berjalan' : m.status === 'done' ? 'Selesai' : blockedBy.length ? 'Menunggu' : 'Siap mulai'}
        </span>
      </div>
      {blockedBy.length > 0 && (
        <div className="banner banner-warn" style={{ padding: '8px 12px' }}>
          <span className="small">
            Menunggu <b>{blockedBy.map((id) => nameOf(s, id)).join(', ')}</b> selesai main di lapangan lain.
          </span>
        </div>
      )}
      {!compact && (
        <div className="court-stage">
          <MatchCourt s={s} m={m} />
        </div>
      )}
      <div className="teams" style={!compact ? { display: 'none' } : undefined}>
        <div className={`team${winA ? ' win' : ''}`}>
          {m.a.map((id) => (
            <span key={id} className="pname" style={id === playerId ? { textDecoration: 'underline' } : undefined}>
              {nameOf(s, id)}
            </span>
          ))}
        </div>
        <div className="score">
          {started || m.final ? (
            <>
              <span key={`a${sc.a}`} className="bignum roll" style={{ fontSize: 26 }}>
                {sc.a}
              </span>
              <span className="sep">:</span>
              <span key={`b${sc.b}`} className="bignum roll" style={{ fontSize: 26 }}>
                {sc.b}
              </span>
            </>
          ) : (
            <span className="vs">VS</span>
          )}
        </div>
        <div className={`team right${winB ? ' win' : ''}`}>
          {m.b.map((id) => (
            <span key={id} className="pname" style={id === playerId ? { textDecoration: 'underline' } : undefined}>
              {nameOf(s, id)}
            </span>
          ))}
        </div>
      </div>
      {s.rules.kind !== 'rally' && s.rules.kind !== 'points' && started && m.status !== 'done' && (
        <div className="tiny mute center num">
          {s.rules.kind === 'sets' && sc.sets.map(([x, y]) => `${x}-${y}`).join(' · ')} {sc.setGamesA !== undefined && `game ${sc.setGamesA}-${sc.setGamesB}`} · poin {sc.gameA}-{sc.gameB}
        </div>
      )}
      {!compact && s.status === 'running' && (
        <div className="row wrap">
          {canScore && m.status !== 'done' && (
            <>
              <Link className="btn btn-dark btn-sm grow" to={`/s/${s.slug}/wasit?m=${m.id}`}>
                <Whistle size={16} /> Wasit
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={() => setQuick(true)}>
                Skor cepat
              </button>
            </>
          )}
          {!canScore && m.status !== 'done' && (
            <Link className="btn btn-ghost btn-sm grow" to={localHref}>
              <Whistle size={16} /> Jadi wasit (lokal)
            </Link>
          )}
          {isHost && m.status !== 'done' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)} aria-label="Ubah pemain">
              <Edit size={16} />
            </button>
          )}
          {isHost && m.status === 'done' && (
            <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => ctx.act({ type: 'reopenMatch', matchId: m.id }))}>
              Koreksi skor
            </button>
          )}
        </div>
      )}
      <QuickScore ctx={ctx} m={m} open={quick} onClose={() => setQuick(false)} />
      {isHost && <EditMatch ctx={ctx} m={m} open={edit} onClose={() => setEdit(false)} />}
    </div>
  );
}

function QuickScore({ ctx, m, open, onClose }: { ctx: Ctx; m: Match; open: boolean; onClose: () => void }) {
  const { s } = ctx;
  const sc = matchScore(s, m);
  const [a, setA] = useState(String(sc.statA || ''));
  const [b, setB] = useState(String(sc.statB || ''));
  const [sets, setSets] = useState<string[][]>([
    ['', ''],
    ['', ''],
    ['', ''],
  ]);
  const { run, busy } = useRun();
  const label = s.rules.kind === 'games' ? 'Game' : 'Poin';
  const save = () =>
    run(async () => {
      if (s.rules.kind === 'sets') {
        const list = sets.map(([x, y]) => [Number(x) || 0, Number(y) || 0]).filter(([x, y]) => x + y > 0);
        await ctx.act({ type: 'final', matchId: m.id, a: 0, b: 0, sets: list });
      } else await ctx.act({ type: 'final', matchId: m.id, a: Number(a) || 0, b: Number(b) || 0 });
      onClose();
    }, 'Skor tersimpan');
  return (
    <Sheet open={open} onClose={onClose} title="Skor cepat">
      <p className="small mute">
        {m.a.map((id) => nameOf(s, id)).join(' & ')} vs {m.b.map((id) => nameOf(s, id)).join(' & ')}
      </p>
      {s.rules.kind === 'sets' ? (
        <div className="stack">
          {sets.map((row, i) => (
            <div key={i} className="row">
              <span className="small mute" style={{ width: 50 }}>
                Set {i + 1}
              </span>
              {[0, 1].map((j) => (
                <input
                  key={j}
                  className="input num center"
                  inputMode="numeric"
                  value={row[j]}
                  placeholder="0"
                  onChange={(e) => setSets((prev) => prev.map((r, k) => (k === i ? (j === 0 ? [e.target.value, r[1]] : [r[0], e.target.value]) : r)))}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="row">
          <label className="field grow">
            <span className="label">{label} tim A</span>
            <input className="input num center" style={{ fontSize: 28, fontWeight: 800 }} inputMode="numeric" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
          <label className="field grow">
            <span className="label">{label} tim B</span>
            <input className="input num center" style={{ fontSize: 28, fontWeight: 800 }} inputMode="numeric" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
      )}
      {requiresWinner(s) && <p className="hint">Format gugur harus ada pemenang.</p>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        Simpan skor
      </button>
    </Sheet>
  );
}

function EditMatch({ ctx, m, open, onClose }: { ctx: Ctx; m: Match; open: boolean; onClose: () => void }) {
  const { s } = ctx;
  const [a, setA] = useState(m.a);
  const [b, setB] = useState(m.b);
  const { run, busy } = useRun();
  const options = s.players.filter((p) => p.status === 'active' || m.a.includes(p.id) || m.b.includes(p.id));
  const pick = (team: 'a' | 'b', i: number, id: string) => (team === 'a' ? setA : setB)((prev) => prev.map((x, k) => (k === i ? id : x)));
  return (
    <Sheet open={open} onClose={onClose} title={`Ubah ${courtName(s, m.court)}`}>
      {(['a', 'b'] as const).map((team) => (
        <div key={team} className="field">
          <span className="label">Tim {team.toUpperCase()}</span>
          {(team === 'a' ? a : b).map((id, i) => (
            <select key={i} className="select" value={id} onChange={(e) => pick(team, i, e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ))}
        </div>
      ))}
      <p className="hint">Ronde yang diubah manual dikunci dan tidak ikut disusun ulang.</p>
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await ctx.act({ type: 'editMatch', matchId: m.id, a, b, version: s.version });
            onClose();
          }, 'Susunan diubah')
        }
      >
        Simpan
      </button>
    </Sheet>
  );
}
