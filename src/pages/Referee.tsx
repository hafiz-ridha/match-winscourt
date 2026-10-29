import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { busyPlayers, courtNow } from '../../shared/engine.ts';
import { requiresWinner } from '../../shared/standings.ts';
import type { Match, Session, Side } from '../../shared/types.ts';
import { api, auth, useLiveSession } from '../api.ts';
import { Back, Whistle } from '../components/Icons.tsx';
import { ScoreBoard } from '../components/ScoreBoard.tsx';
import { MatchCourt } from '../components/MatchCourt.tsx';
import { Brand, Loader, useToast } from '../components/ui.tsx';
import { courtName, teamNames } from './session/helpers.ts';

type Act = { type: string; matchId: string; side?: Side; target?: number };

/** Terapkan aksi yang belum terkirim di atas data server (tampilan instan & offline). */
function applyPending(m: Match, pending: Act[]): Match {
  const x: Match = { ...m, events: m.events.slice() };
  for (const a of pending) {
    if (a.matchId !== m.id) continue;
    if (a.type === 'point' && a.side) x.events.push(a.side);
    if (a.type === 'minus' && a.side) {
      const i = x.events.lastIndexOf(a.side);
      if (i >= 0) x.events.splice(i, 1);
    }
    if (a.type === 'undo') x.events.pop();
    if (a.type === 'reset') {
      x.events = [];
      x.final = undefined;
      x.target = undefined;
    }
    if (a.type === 'target') x.target = a.target;
    if (a.type === 'server') x.server = a.side;
    if (a.type === 'swap') x.swapped = !x.swapped;
    if (a.type === 'finishMatch') x.status = 'done';
  }
  return x;
}

function pickMatch(s: Session, matchId: string | null, court: number): Match | undefined {
  if (matchId) {
    const m = s.rounds.flatMap((r) => r.matches).find((x) => x.id === matchId);
    if (m && m.status !== 'done') return m;
  }
  // Alur per lapangan: match yang sedang/akan dimainkan di lapangan ini.
  return courtNow(s, court)?.match;
}

export function Referee() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const key = params.get('key');
  if (key) auth.setRefKey(slug, key);
  const live = useLiveSession(slug);
  const toast = useToast();
  const nav = useNavigate();
  const queueKey = `mwc.q.${slug}`;
  // Antrean aksi: ref = sumber kebenaran (sinkron), state = untuk render. Disimpan di HP agar aman saat offline.
  const queue = useRef<Act[]>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(queueKey) ?? '[]') as Act[];
      } catch {
        return [];
      }
    })(),
  );
  const [pending, setPending] = useState<Act[]>(queue.current);
  const [offline, setOffline] = useState(false);
  const sending = useRef(false);
  const [court, setCourt] = useState(0);
  const { setLocal } = live;

  const sync = useCallback(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(queue.current));
    } catch {
      /* abaikan */
    }
    setPending(queue.current.slice());
  }, [queueKey]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const next = queue.current[0];
        try {
          const r = await api.action(slug, next as unknown as Record<string, unknown>);
          queue.current.shift();
          sync();
          setLocal(r.session);
          setOffline(false);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('koneksi')) {
            setOffline(true);
            break;
          }
          queue.current.shift();
          sync();
          toast(msg, true);
        }
      }
    } finally {
      sending.current = false;
    }
  }, [slug, sync, setLocal, toast]);

  useEffect(() => {
    flush();
    const t = setInterval(() => queue.current.length && flush(), 3000);
    return () => clearInterval(t);
  }, [flush]);

  const s = live.session;
  const base = useMemo(() => (s ? pickMatch(s, params.get('m'), court) : undefined), [s, params, court]);
  useEffect(() => {
    if (base) setCourt(base.court);
  }, [base?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (live.error && !s)
    return (
      <div className="app">
        <div className="card stack center">
          <p>{live.error}</p>
          <Link to="/" className="btn btn-primary">
            Beranda
          </Link>
        </div>
      </div>
    );
  if (!s) return <Loader text="Membuka papan wasit…" />;

  const canScore = live.role === 'host' || live.role === 'referee';
  const m = base ? applyPending(base, pending) : undefined;
  const busy = base ? busyPlayers(s, base) : [];
  const push = (a: Act) => {
    queue.current.push(a);
    sync();
    flush();
  };

  return (
    <div className="app stack">
      <div className="topbar">
        <Brand sub={canScore ? 'Mode wasit' : 'Lihat skor'} />
        {offline && <span className="chip chip-warn tiny">Offline · skor disimpan di HP</span>}
        {!offline && pending.length > 0 && <span className="chip tiny">Mengirim {pending.length}…</span>}
      </div>
      <div className="row">
        <Link to={`/s/${slug}`} className="icon-btn" aria-label="Kembali ke sesi">
          <Back size={18} />
        </Link>
        <div className="grow">
          <div className="tiny mute">{s.name}</div>
          <h2>Papan skor</h2>
        </div>
      </div>

      {s.courts > 1 && (
        <div className="seg">
          {Array.from({ length: s.courts }, (_, i) => (
            <button
              key={i}
              className={court === i ? 'on' : ''}
              onClick={() => {
                setCourt(i);
                const next = new URLSearchParams(params);
                next.delete('m');
                setParams(next, { replace: true });
              }}
            >
              {courtName(s, i)}
            </button>
          ))}
        </div>
      )}

      {!canScore && (
        <div className="banner banner-warn">
          <Whistle size={18} />
          <span>
            Kamu belum ditunjuk sebagai wasit. Minta <b>link wasit</b> dari host, atau pakai{' '}
            <Link to={`/wasit-lokal?sport=${s.sport}`}>papan skor lokal</Link>.
          </span>
        </div>
      )}

      {s.status !== 'running' ? (
        <div className="card card-surface center small mute">{s.status === 'draft' ? 'Sesi belum dimulai.' : 'Sesi sudah selesai.'}</div>
      ) : !m ? (
        <div className="card card-surface center small mute">Tidak ada match terjadwal di {courtName(s, court)}.</div>
      ) : (
        <>
          <div className="row-between small">
            <b>{courtName(s, m.court)}</b>
            <span className="mute">
              Ronde {s.rounds.find((r) => r.matches.some((x) => x.id === m.id))?.n}
              {m.stage ? ` · ${m.stage}` : ''}
            </span>
          </div>
          {busy.length > 0 && m.status === 'scheduled' && m.events.length === 0 && (
            <div className="banner banner-warn">
              <span>
                <b>Belum bisa mulai.</b> {[...new Set(busy)].map((id) => s.players.find((p) => p.id === id)?.name).join(', ')} masih punya match di ronde
                sebelumnya. Tunggu selesai dulu.
              </span>
            </div>
          )}
          <div className="court-stage">
            <MatchCourt s={s} m={m} />
          </div>
          <ScoreBoard
            sport={s.sport}
            rules={s.rules}
            match={m}
            namesA={teamNames(s, m.a)}
            namesB={teamNames(s, m.b)}
            readOnly={!canScore || m.status === 'done' || (busy.length > 0 && m.events.length === 0)}
            requireWinner={requiresWinner(s)}
            onPoint={(side) => push({ type: 'point', matchId: m.id, side })}
            onMinus={(side) => push({ type: 'minus', matchId: m.id, side })}
            onUndo={() => push({ type: 'undo', matchId: m.id })}
            onServer={(side) => push({ type: 'server', matchId: m.id, side })}
            onSwap={() => push({ type: 'swap', matchId: m.id })}
            onReset={() => push({ type: 'reset', matchId: m.id })}
            onTarget={(target) => push({ type: 'target', matchId: m.id, target })}
            onFinish={() => {
              push({ type: 'finishMatch', matchId: m.id });
              toast('Skor disimpan');
              const next = new URLSearchParams(params);
              next.delete('m');
              setParams(next, { replace: true });
            }}
          />
          {m.status === 'done' && (
            <button className="btn btn-dark btn-block" onClick={() => nav(`/s/${slug}`)}>
              Kembali ke lapangan
            </button>
          )}
        </>
      )}
      <p className="tiny mute center">Ketuk angka atau tombol + untuk menambah poin. Skor tersinkron ke semua HP secara live.</p>
    </div>
  );
}
