import { useEffect, useRef, useState } from 'react';
import { rulesLabel } from '../../shared/formats.ts';
import { autoServer, computeScore } from '../../shared/scoring.ts';
import type { Match, ScoreRules, Side, Sport } from '../../shared/types.ts';
import { Ball, Reset, Shuttle, Swap, Undo } from './Icons.tsx';
import { Sheet, Stepper } from './ui.tsx';

export interface BoardHandlers {
  onPoint: (side: Side) => void;
  onMinus: (side: Side) => void;
  onUndo: () => void;
  onServer: (side: Side) => void;
  onSwap: () => void;
  onReset: () => void;
  onTarget: (n: number) => void;
  onFinish: () => void;
}

interface Props extends BoardHandlers {
  sport: Sport;
  rules: ScoreRules;
  match: Match;
  namesA: string;
  namesB: string;
  readOnly?: boolean;
  requireWinner?: boolean;
  finishLabel?: string;
}

/**
 * Papan skor wasit: dua kartu tim besar. Ketuk kartu atau tombol +1 untuk menambah poin,
 * −1 untuk koreksi, tombol Servis untuk memindah penanda servis. Ulang 0 selalu minta konfirmasi.
 */
export function ScoreBoard(p: Props) {
  const st = computeScore(p.match, p.rules, { requireWinner: p.requireWinner });
  const server: Side = p.rules.kind === 'points' ? autoServer(p.match, p.rules) : (p.match.server ?? 'a');
  const order: Side[] = p.match.swapped ? ['b', 'a'] : ['a', 'b'];
  const [fly, setFly] = useState<{ side: Side; n: number } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const flyN = useRef(0);
  const started = p.match.events.length > 0;

  const tap = (side: Side) => {
    if (p.readOnly || st.done) return;
    flyN.current++;
    setFly({ side, n: flyN.current });
    if (navigator.vibrate) navigator.vibrate(12);
    p.onPoint(side);
  };

  useEffect(() => {
    if (!fly) return;
    const t = setTimeout(() => setFly(null), 700);
    return () => clearTimeout(t);
  }, [fly]);

  const value = (side: Side) => (side === 'a' ? st.a : st.b);
  const game = (side: Side) => (side === 'a' ? st.gameA : st.gameB);
  const setGames = (side: Side) => (side === 'a' ? st.setGamesA : st.setGamesB);
  const unit = p.rules.kind === 'games' ? 'game' : p.rules.kind === 'sets' ? 'set' : 'poin';
  const pointUnit = p.rules.kind === 'rally' || p.rules.kind === 'points' ? 'poin' : 'poin game';
  const canMoveServer = p.rules.kind !== 'points';

  return (
    <div className="stack">
      <div className="board">
        {order.map((side) => {
          const isWinner = st.done && st.winner === side;
          const serving = server === side && !st.done;
          return (
            <div key={side} className={`side team-${side}${serving ? ' serving' : ''}${isWinner ? ' winner' : ''}`}>
              <div className="side-head">
                <span className={`team-tag team-${side}`}>Tim {side.toUpperCase()}</span>
                {canMoveServer && !p.readOnly ? (
                  <button className={`serve-pill${serving ? ' on' : ''}`} onClick={() => p.onServer(side)} disabled={st.done} aria-pressed={serving} title={serving ? 'Tim ini sedang servis' : 'Ketuk untuk memindah servis ke tim ini'}>
                    {p.sport === 'padel' ? <Ball size={13} /> : <Shuttle size={13} />}
                    Servis
                  </button>
                ) : (
                  serving && (
                    <span className="serve-pill on">
                      {p.sport === 'padel' ? <Ball size={13} /> : <Shuttle size={13} />}
                      Servis
                    </span>
                  )
                )}
              </div>
              <div className="names">{side === 'a' ? p.namesA : p.namesB}</div>
              <button className="tap" disabled={p.readOnly || st.done} onClick={() => tap(side)} aria-label={`Tambah ${pointUnit} tim ${side.toUpperCase()}`}>
                <span key={value(side)} className="bignum roll">
                  {value(side)}
                </span>
                {p.rules.kind === 'sets' && !st.done && (
                  <span className="small mute num">
                    game {setGames(side) ?? 0}
                    {st.tiebreak ? ' · TB' : ''}
                  </span>
                )}
                {game(side) !== undefined && <span className="gamept">{game(side)}</span>}
                {isWinner ? (
                  <span className="chip chip-dark tiny">MENANG</span>
                ) : (
                  !p.readOnly && !st.done && <span className="tap-hint">Ketuk untuk +1</span>
                )}
              </button>
              {!p.readOnly && (
                <div className="pm">
                  <button
                    className="minus"
                    disabled={!started || st.done}
                    onClick={() => (p.rules.kind === 'rally' || p.rules.kind === 'points' ? p.onMinus(side) : p.onUndo())}
                    aria-label={`Kurangi ${pointUnit} tim ${side.toUpperCase()}`}
                  >
                    −1
                  </button>
                  <button className="plus" disabled={st.done} onClick={() => tap(side)} aria-label={`Tambah ${pointUnit} tim ${side.toUpperCase()}`}>
                    +1
                  </button>
                </div>
              )}
              {fly?.side === side && (
                <span key={fly.n} className="fly">
                  {p.sport === 'padel' ? <Ball size={26} /> : <Shuttle size={28} />}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="card card-dark card-tight rulebar">
        {p.rules.kind === 'rally' ? (
          <div>
            <div className="tiny mute">Target poin</div>
            {p.readOnly ? (
              <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>
                {st.target}
              </span>
            ) : (
              <Stepper value={st.target} min={5} max={99} onChange={p.onTarget} />
            )}
          </div>
        ) : (
          <div className="small">
            <div className="tiny mute">Aturan</div>
            {rulesLabel(p.rules)}
          </div>
        )}
        <div style={{ textAlign: 'right' }}>
          <div className="tiny mute">{p.rules.kind === 'rally' ? 'Aturan' : 'Skor'}</div>
          <div className="small" style={{ fontWeight: 700 }}>
            {p.rules.kind === 'rally' ? 'Selisih 2 poin' : p.rules.kind === 'sets' ? st.sets.map(([x, y]) => `${x}-${y}`).join(' · ') || '—' : `${st.statA}–${st.statB}`}
          </div>
          <div className="tiny num" style={{ color: st.matchPoint ? 'var(--lime)' : undefined, opacity: st.matchPoint ? 1 : 0.7 }}>
            {st.matchPoint ? `Match point Tim ${st.matchPoint.toUpperCase()}` : p.rules.kind === 'rally' ? `${st.a}–${st.b}` : ''}
          </div>
        </div>
      </div>

      {!p.readOnly && st.done && (
        <button className="btn btn-primary btn-block btn-lg rise" onClick={p.onFinish}>
          {p.finishLabel ?? 'Simpan skor'}
        </button>
      )}

      {!p.readOnly && (
        <div className="board-actions">
          <button onClick={p.onSwap}>
            <Swap size={20} />
            <span>Tukar sisi</span>
          </button>
          <button onClick={p.onUndo} disabled={!started}>
            <Undo size={20} />
            <span>Batal poin</span>
          </button>
          <button onClick={() => setConfirmReset(true)} disabled={!started} className="danger">
            <Reset size={20} />
            <span>Ulang 0</span>
          </button>
        </div>
      )}

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Ulang skor ke 0–0?">
        <p className="small mute">
          Skor {st.a}–{st.b} akan dihapus. Gunakan <b>Batal poin</b> kalau hanya salah tekan satu {unit === 'poin' ? 'poin' : 'kali'}.
        </p>
        <button
          className="btn btn-danger btn-block"
          onClick={() => {
            p.onReset();
            setConfirmReset(false);
          }}
        >
          Ya, ulang ke 0–0
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => setConfirmReset(false)}>
          Tidak jadi
        </button>
      </Sheet>
    </div>
  );
}
