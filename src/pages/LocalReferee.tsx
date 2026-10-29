import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { defaultRules } from '../../shared/formats.ts';
import type { Match, ScoreKind, ScoreRules, Side, Sport } from '../../shared/types.ts';
import { Back, Ball, Chevron, Shuttle } from '../components/Icons.tsx';
import { ScoreBoard } from '../components/ScoreBoard.tsx';
import { Brand, Seg, Switch, useToast } from '../components/ui.tsx';

const KEY = 'mwc.local';

interface LocalState {
  sport: Sport;
  rules: ScoreRules;
  nameA: string;
  nameB: string;
  match: Match;
}

const fresh = (): Match => ({ id: 'local', court: 0, a: [], b: [], events: [], status: 'live' });

/** Layar tetap menyala selama papan skor dipakai (jika browser mendukung). */
function useWakeLock(on: boolean) {
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  useEffect(() => {
    if (!on || !supported) return;
    let cancelled = false;
    const request = async () => {
      try {
        const l = await (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen');
        if (cancelled) l.release();
        else lock.current = l;
      } catch {
        /* ditolak browser, abaikan */
      }
    };
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [on, supported]);
  return supported;
}

/** Papan skor lokal: siapa pun bisa pakai, tanpa login & tanpa internet. Tidak mengubah skor resmi. */
export function LocalReferee() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [st, setSt] = useState<LocalState>(() => {
    const sport = (params.get('sport') as Sport) || 'badminton';
    const fromLink = params.get('a') || params.get('b');
    if (!fromLink) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as LocalState | null;
        // Lanjutkan skor tersimpan, kecuali dibuka untuk olahraga lain.
        if (saved && (!params.get('sport') || saved.sport === sport)) return saved;
      } catch {
        /* abaikan */
      }
    }
    const rules = defaultRules(sport);
    const kind = params.get('kind') as ScoreKind | null;
    if (kind && (sport === 'padel' ? kind !== 'rally' : kind === 'rally')) rules.kind = kind;
    const t = Number(params.get('target'));
    if (t) rules.target = t;
    return { sport, rules, nameA: params.get('a') ?? 'Tim A', nameB: params.get('b') ?? 'Tim B', match: fresh() };
  });
  const [awake, setAwake] = useState(true);
  const [setupOpen, setSetupOpen] = useState(() => !(params.get('a') || params.get('b')));
  const wakeSupported = useWakeLock(awake);
  const started = st.match.events.length > 0;

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* abaikan */
    }
  }, [st]);

  const m = st.match;
  const upd = (fn: (x: Match) => Match) => setSt((p) => ({ ...p, match: fn({ ...p.match, events: p.match.events.slice() }) }));
  const point = (side: Side) => {
    if (setupOpen) setSetupOpen(false);
    upd((x) => ({ ...x, events: [...x.events, side] }));
  };
  const setSport = (sport: Sport) => setSt((p) => ({ ...p, sport, rules: defaultRules(sport), match: fresh() }));
  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => toast('Browser ini tidak mendukung layar penuh', true));
  };

  return (
    <div className="app stack">
      <div className="topbar">
        <Brand sub="Papan skor lokal" />
        <button className="btn btn-ghost btn-sm" onClick={fullscreen}>
          Layar penuh
        </button>
      </div>
      <div className="row">
        <Link to="/" className="icon-btn" aria-label="Kembali">
          <Back size={18} />
        </Link>
        <div className="grow">
          <h1 style={{ fontSize: 24 }}>Papan skor</h1>
          <p className="tiny mute">Tanpa login & internet · tidak mengubah skor resmi sesi</p>
        </div>
      </div>

      <div className="card card-tight stack">
        <button className="row-between" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', width: '100%' }} onClick={() => setSetupOpen((v) => !v)} aria-expanded={setupOpen}>
          <span className="row" style={{ gap: 8 }}>
            {st.sport === 'padel' ? <Ball size={20} /> : <Shuttle size={22} />}
            <b>
              {st.nameA} <span className="mute">vs</span> {st.nameB}
            </b>
          </span>
          <span className="row tiny mute" style={{ gap: 4 }}>
            Atur <Chevron size={16} style={{ transform: setupOpen ? 'rotate(180deg)' : undefined, transition: 'transform .3s' }} />
          </span>
        </button>
        {setupOpen && (
          <div className="stack rise">
            <div className="sport-switch" role="radiogroup" aria-label="Olahraga">
              {(['badminton', 'padel'] as Sport[]).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  role="radio"
                  aria-checked={st.sport === sp}
                  className={`${sp}${st.sport === sp ? ' on' : ''}`}
                  disabled={started && st.sport !== sp}
                  onClick={() => st.sport !== sp && setSport(sp)}
                >
                  {sp === 'padel' ? <Ball size={22} /> : <Shuttle size={24} />}
                  {sp === 'padel' ? 'Padel' : 'Badminton'}
                </button>
              ))}
            </div>
            {started && <p className="tiny mute">Untuk ganti olahraga atau tipe skor, tekan Ulang 0 dulu.</p>}
            {st.sport === 'padel' && (
              <div className="field">
                <span className="label">Tipe skor</span>
                <Seg
                  value={st.rules.kind}
                  onChange={(kind) => !started && setSt((p) => ({ ...p, rules: { ...p.rules, kind }, match: fresh() }))}
                  options={[
                    { v: 'points', label: 'Poin langsung' },
                    { v: 'games', label: 'Game' },
                    { v: 'sets', label: 'Set' },
                  ]}
                />
              </div>
            )}
            <div className="row">
              <label className="field grow">
                <span className="label">Nama Tim A</span>
                <input className="input" value={st.nameA} maxLength={30} onChange={(e) => setSt((p) => ({ ...p, nameA: e.target.value }))} onFocus={(e) => e.target.select()} />
              </label>
              <label className="field grow">
                <span className="label">Nama Tim B</span>
                <input className="input" value={st.nameB} maxLength={30} onChange={(e) => setSt((p) => ({ ...p, nameB: e.target.value }))} onFocus={(e) => e.target.select()} />
              </label>
            </div>
            {wakeSupported && <Switch label="Layar tetap menyala" hint="HP tidak mati sendiri selama papan skor terbuka." on={awake} onChange={setAwake} />}
            <button className="btn btn-dark btn-block" onClick={() => setSetupOpen(false)}>
              Mulai catat skor
            </button>
          </div>
        )}
      </div>

      <ScoreBoard
        sport={st.sport}
        rules={st.rules}
        match={m}
        namesA={st.nameA}
        namesB={st.nameB}
        onPoint={point}
        onMinus={(side) =>
          upd((x) => {
            const i = x.events.lastIndexOf(side);
            if (i >= 0) x.events.splice(i, 1);
            return x;
          })
        }
        onUndo={() => upd((x) => ({ ...x, events: x.events.slice(0, -1) }))}
        onServer={(side) => upd((x) => ({ ...x, server: side }))}
        onSwap={() =>
          setSt((p) => ({
            ...p,
            nameA: p.nameB,
            nameB: p.nameA,
            match: { ...p.match, events: p.match.events.map((e) => (e === 'a' ? 'b' : 'a')), server: p.match.server === 'a' ? 'b' : p.match.server === 'b' ? 'a' : undefined },
          }))
        }
        onReset={() => upd(() => fresh())}
        onTarget={(target) => upd((x) => ({ ...x, target }))}
        onFinish={() => {
          toast('Match selesai. Skor lokal tidak tersimpan ke sesi.');
          upd(() => fresh());
        }}
        finishLabel="Selesai & mulai match baru"
      />

      <details className="adv card card-surface card-tight small">
        <summary>
          Cara pakai <Chevron size={16} className="chev" />
        </summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }} className="mute">
          <li>Ketuk kartu tim atau tombol +1 untuk menambah poin. −1 untuk koreksi.</li>
          <li>Tombol Servis memindahkan penanda servis.</li>
          <li>Tukar sisi memindahkan nama, skor, dan servis.</li>
          <li>Skor tersimpan di tab ini. Tutup tab = skor hilang.</li>
        </ul>
      </details>
    </div>
  );
}
