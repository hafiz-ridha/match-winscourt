import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, auth, type SessionSummary } from '../api.ts';
import { playerStandings } from '../../shared/standings.ts';
import {
  calibMaps,
  classifyAll,
  courtLines,
  detectHits,
  frameDt,
  nearestPlayer,
  newHitId,
  SHOT_TYPES,
  shotLabel,
  smoothCourt,
  summarize,
  swapSlots,
  trackPlayers,
  trackShuttle,
  COURTS,
  type FrameObs,
  type Quad,
  type Sport,
} from '../analysis/core.ts';
import { drawMiniCourt, drawOverlay, exportVideo, frameAt, PLAYER_COLORS, recorderMime, type Ranking, type Result } from '../analysis/render.ts';
import { FrameProcessor, loadEngine, seek, type Engine } from '../analysis/vision.ts';
import { Back, Ball, Download, Info, Share, Shuttle, Swap } from '../components/Icons.tsx';
import { Brand, Loader, Seg, Switch, useToast } from '../components/ui.tsx';
import { LoginCard } from './Home.tsx';

const FPS = 15;
const STEPS = ['Video', 'Lapangan', 'Proses', 'Periksa', 'Hasil'];
const DEFAULT_QUAD: Quad = [
  { x: 0.36, y: 0.4 },
  { x: 0.64, y: 0.4 },
  { x: 0.88, y: 0.88 },
  { x: 0.12, y: 0.88 },
];
const CORNER_HINT = ['Kiri jauh', 'Kanan jauh', 'Kanan dekat', 'Kiri dekat'];

const mmss = (s: number, cs = false) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${(cs ? r.toFixed(2) : Math.floor(r).toString()).padStart(cs ? 5 : 2, '0').replace('.', ',')}`;
};
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Setup {
  sport: Sport;
  teamSize: 1 | 2;
  teamA: string[];
  teamB: string[];
  title: string;
  from?: { slug: string; matchId: string };
}

/** AI Match Analysis khusus pengguna yang sudah login (penyewa Wins Court atau akun umum). */
export function Analysis() {
  const [state, setState] = useState<'checking' | 'in' | 'out'>(auth.token ? 'checking' : 'out');
  useEffect(() => {
    if (!auth.token) return;
    api
      .me()
      .then(() => setState('in'))
      .catch(() => setState(auth.token ? 'in' : 'out'));
  }, []);
  if (state === 'checking') return <Loader text="Memeriksa akun…" />;
  if (state === 'out') return <LoginGate onDone={() => setState('in')} />;
  return <AnalysisApp />;
}

function LoginGate({ onDone }: { onDone: () => void }) {
  return (
    <div className="app an stack-lg">
      <div className="topbar">
        <Link to="/" className="icon-btn" aria-label="Kembali">
          <Back size={20} />
        </Link>
        <Brand sub="AI Match Analysis" />
        <span className="beta-tag">BETA</span>
      </div>
      <LoginCard
        onDone={onDone}
        title="Masuk untuk AI Match Analysis"
        hint="Untuk penyewa Wins Court dan pemilik akun umum. Sesudah masuk, langsung lanjut ke analisis."
      />
    </div>
  );
}

function AnalysisApp() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState<Setup>({
    sport: params.get('sport') === 'padel' ? 'padel' : 'badminton',
    teamSize: 2,
    teamA: ['', ''],
    teamB: ['', ''],
    title: 'AI Match Analysis',
  });
  const [src, setSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ duration: number; aspect: number } | null>(null);
  const [clip, setClip] = useState({ start: 0, len: 60 });
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  const [nearIsA, setNearIsA] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const procVideo = useRef<HTMLVideoElement>(null);

  // Dari kartu match di sesi: isi olahraga, format & nama pemain otomatis.
  const slug = params.get('s');
  const matchId = params.get('m');
  useEffect(() => {
    if (!slug || !matchId) return;
    api
      .session(slug)
      .then(({ session: s }) => {
        const m = s.rounds.flatMap((r) => r.matches).find((x) => x.id === matchId);
        if (!m) return;
        const nm = (id: string) => s.players.find((p) => p.id === id)?.name ?? '';
        const court = s.courtNames[m.court] ?? '';
        setSetup({
          sport: s.sport,
          teamSize: m.a.length === 1 ? 1 : 2,
          teamA: m.a.map(nm),
          teamB: m.b.map(nm),
          title: `${s.name}${court ? ` · ${court}` : ''}`,
          from: { slug, matchId },
        });
      })
      .catch(() => toast('Data match tidak bisa dimuat, isi nama pemain manual.', true));
  }, [slug, matchId, toast]);

  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const names = useMemo(() => {
    const near = (nearIsA ? setup.teamA : setup.teamB).slice(0, setup.teamSize);
    const far = (nearIsA ? setup.teamB : setup.teamA).slice(0, setup.teamSize);
    return [...near, ...far].map((n, i) => n.trim() || `Pemain ${i + 1}`);
  }, [setup, nearIsA]);

  const end = meta ? Math.min(meta.duration, clip.start + clip.len) : 0;

  return (
    <div className="app an stack-lg">
      <div className="topbar">
        <Link to={setup.from ? `/s/${setup.from.slug}` : '/'} className="icon-btn" aria-label="Kembali">
          <Back size={20} />
        </Link>
        <Brand sub="AI Match Analysis" />
        <span className="beta-tag" title="Fitur percobaan: hasil AI perlu diperiksa">
          BETA
        </span>
      </div>

      <div className="an-head">
        <div className="eyebrow">{setup.sport === 'badminton' ? 'Badminton' : 'Padel'} · {setup.teamSize === 1 ? 'Tunggal' : 'Ganda'}</div>
        <h1 className="an-title">AI Match Analysis</h1>
        <p className="small mute">Hitung pukulan, jarak lari, zona main & kalori dari video main — langsung di HP, video tidak diunggah.</p>
      </div>

      <ol className="an-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''}>
            <span className="an-step-n">{i < step ? '✓' : i + 1}</span>
            <span className="an-step-l">{s}</span>
          </li>
        ))}
      </ol>

      {/* Video tersembunyi untuk membaca frame (harus ada di DOM untuk Safari iPhone). */}
      {src && <video ref={procVideo} src={src} muted playsInline preload="auto" className="an-hidden-video" />}

      {step === 0 && (
        <SetupStep
          setup={setup}
          setSetup={setSetup}
          src={src}
          meta={meta}
          clip={clip}
          setClip={setClip}
          onFile={(f) => {
            if (src) URL.revokeObjectURL(src);
            setSrc(URL.createObjectURL(f));
            setMeta(null);
            setResult(null);
          }}
          onMeta={(m) => {
            setMeta(m);
            setClip((c) => ({ start: Math.min(c.start, Math.max(0, m.duration - 5)), len: c.len }));
          }}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && src && meta && (
        <CalibStep
          src={src}
          sport={setup.sport}
          at={clip.start + 0.5}
          quad={quad}
          setQuad={setQuad}
          nearIsA={nearIsA}
          setNearIsA={setNearIsA}
          teamA={setup.teamA.slice(0, setup.teamSize)}
          teamB={setup.teamB.slice(0, setup.teamSize)}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && meta && (
        <ProcessStep
          video={procVideo}
          setup={setup}
          cal={{ sport: setup.sport, quad, aspect: meta.aspect }}
          start={clip.start}
          end={end}
          names={names}
          onCancel={() => setStep(1)}
          onDone={(r) => {
            setResult(r);
            setStep(3);
          }}
        />
      )}
      {step === 3 && result && src && <ReviewStep src={src} r={result} setR={setResult} onBack={() => setStep(1)} onNext={() => setStep(4)} />}
      {step === 4 && result && src && <ResultStep src={src} r={result} setR={setResult} patch={(x) => setResult((cur) => (cur ? { ...cur, ...x } : cur))} end={end} onBack={() => setStep(3)} from={setup.from} />}
    </div>
  );
}

/* ---------------- 1. Video ---------------- */

function SetupStep({
  setup,
  setSetup,
  src,
  meta,
  clip,
  setClip,
  onFile,
  onMeta,
  onNext,
}: {
  setup: Setup;
  setSetup: (s: Setup) => void;
  src: string | null;
  meta: { duration: number; aspect: number } | null;
  clip: { start: number; len: number };
  setClip: (c: { start: number; len: number }) => void;
  onFile: (f: File) => void;
  onMeta: (m: { duration: number; aspect: number }) => void;
  onNext: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const locked = !!setup.from;
  const setName = (team: 'teamA' | 'teamB', i: number, v: string) => {
    const arr = [...setup[team]];
    arr[i] = v;
    setSetup({ ...setup, [team]: arr });
  };
  useEffect(() => {
    const v = preview.current;
    if (v && meta) v.currentTime = clip.start + 0.1;
  }, [clip.start, meta]);
  const maxLen = meta ? Math.max(5, meta.duration - clip.start) : 120;
  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row-between">
          <h3>Pertandingan</h3>
          {locked && <span className="chip chip-lime tiny">Dari match sesi</span>}
        </div>
        {!locked && (
          <div className="row wrap">
            <div className="grow" style={{ minWidth: 160 }}>
              <Seg
                value={setup.sport}
                onChange={(v) => setSetup({ ...setup, sport: v })}
                options={[
                  {
                    v: 'badminton',
                    label: (
                      <span className="an-sport">
                        <Shuttle size={18} /> Badminton
                      </span>
                    ),
                  },
                  {
                    v: 'padel',
                    label: (
                      <span className="an-sport">
                        <Ball size={16} /> Padel
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <div className="grow" style={{ minWidth: 160 }}>
              <Seg
                value={setup.teamSize}
                onChange={(v) => setSetup({ ...setup, teamSize: v })}
                options={[
                  { v: 2, label: 'Ganda' },
                  { v: 1, label: 'Tunggal' },
                ]}
              />
            </div>
          </div>
        )}
        <div className="an-teams">
          {(['teamA', 'teamB'] as const).map((team, ti) => (
            <div key={team} className="stack" style={{ gap: 6 }}>
              <span className="label">{ti === 0 ? 'Tim A' : 'Tim B'}</span>
              {Array.from({ length: setup.teamSize }, (_, i) => (
                <input
                  key={i}
                  className="input"
                  value={setup[team][i] ?? ''}
                  placeholder={`Pemain ${ti * setup.teamSize + i + 1}`}
                  onChange={(e) => setName(team, i, e.target.value)}
                  maxLength={24}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h3>Pilih video</h3>
        <label className="an-drop">
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <b>{src ? 'Ganti video' : 'Pilih video dari galeri'}</b>
          <span className="tiny mute">MP4 / MOV dari HP. Paling bagus 30–90 detik, direkam dari belakang lapangan.</span>
        </label>
        {src && (
          <>
            <video
              ref={preview}
              src={src}
              className="an-preview"
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (!v.videoWidth) return;
                // Sebagian rekaman (WebM) belum punya durasi: lompat ke akhir supaya browser menghitungnya.
                if (!Number.isFinite(v.duration)) v.currentTime = 1e7;
                else onMeta({ duration: v.duration, aspect: v.videoWidth / v.videoHeight });
              }}
              onDurationChange={(e) => {
                const v = e.currentTarget;
                if (meta || !v.videoWidth || !Number.isFinite(v.duration)) return;
                onMeta({ duration: v.duration, aspect: v.videoWidth / v.videoHeight });
                v.currentTime = 0.1;
              }}
              onError={() => onMeta({ duration: 0, aspect: 16 / 9 })}
            />
            {meta && meta.duration > 0 && (
              <div className="stack">
                <label className="field">
                  <span className="label">
                    Mulai dari <b className="num">{mmss(clip.start)}</b> · durasi video {mmss(meta.duration)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, meta.duration - 3)}
                    step={0.5}
                    value={clip.start}
                    onChange={(e) => setClip({ ...clip, start: Number(e.target.value) })}
                  />
                </label>
                <span className="label">Panjang yang dianalisis</span>
                <Seg
                  value={Math.min(clip.len, 120)}
                  onChange={(v) => setClip({ ...clip, len: v })}
                  options={[30, 60, 90, 120].filter((x, i) => i === 0 || x - 30 < maxLen).map((x) => ({ v: x, label: `${x} dtk` }))}
                />
              </div>
            )}
            {meta && meta.duration === 0 && <div className="banner banner-danger">Video ini tidak bisa dibaca browser. Coba rekam ulang dalam format MP4 (H.264).</div>}
          </>
        )}
      </div>

      <div className="card card-surface stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Info size={18} />
          <b className="small">Tips rekam supaya akurat</b>
        </div>
        <ul className="an-tips small mute">
          <li>Kamera diam (tripod / disandarkan) di belakang baseline, agak tinggi.</li>
          <li>Seluruh lapangan & keempat sudutnya terlihat.</li>
          <li>Cahaya cukup; hindari melawan lampu atau jendela.</li>
          <li>Rekam horizontal 30–60 fps.</li>
        </ul>
      </div>

      <button className="btn btn-primary btn-lg btn-block" disabled={!src || !meta || meta.duration === 0} onClick={onNext}>
        Lanjut: tandai lapangan
      </button>
    </div>
  );
}

/* ---------------- 2. Lapangan ---------------- */

function CalibStep({
  src,
  sport,
  at,
  quad,
  setQuad,
  nearIsA,
  setNearIsA,
  teamA,
  teamB,
  onBack,
  onNext,
}: {
  src: string;
  sport: Sport;
  at: number;
  quad: Quad;
  setQuad: (q: Quad) => void;
  nearIsA: boolean;
  setNearIsA: (v: boolean) => void;
  teamA: string[];
  teamB: string[];
  onBack: () => void;
  onNext: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const draw = useCallback(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth > 1280 ? 1280 : v.videoWidth;
    c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const W = c.width;
    const H = c.height;
    const { spec, toImage } = calibMaps({ sport, quad, aspect: W / H });
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.strokeStyle = '#C6FF3D';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    for (const [a, b] of courtLines(spec)) {
      const A = toImage(a);
      const B = toImage(b);
      ctx.beginPath();
      ctx.moveTo(A.x * W, A.y * H);
      ctx.lineTo(B.x * W, B.y * H);
      ctx.stroke();
    }
    // Net
    const n1 = toImage({ x: -0.3, y: spec.L / 2 });
    const n2 = toImage({ x: spec.W + 0.3, y: spec.L / 2 });
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, W / 260);
    ctx.beginPath();
    ctx.moveTo(n1.x * W, n1.y * H);
    ctx.lineTo(n2.x * W, n2.y * H);
    ctx.stroke();
  }, [quad, sport]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onSeeked = () => {
      setReady(true);
      draw();
    };
    v.addEventListener('seeked', onSeeked);
    const go = () => (v.currentTime = at);
    if (v.readyState >= 1) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
    return () => v.removeEventListener('seeked', onSeeked);
  }, [at, draw]);
  useEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  const move = (e: RPointerEvent) => {
    if (drag === null || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const p = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    const q = [...quad] as Quad;
    q[drag] = p;
    setQuad(q);
  };

  const nearNames = (nearIsA ? teamA : teamB).filter(Boolean).join(' & ') || (nearIsA ? 'Tim A' : 'Tim B');
  const farNames = (nearIsA ? teamB : teamA).filter(Boolean).join(' & ') || (nearIsA ? 'Tim B' : 'Tim A');

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div>
          <h3>Tandai lapangan</h3>
          <p className="small mute">
            Geser 4 titik ke sudut garis luar lapangan sampai <b>garis lime menempel garis putih</b>.
          </p>
        </div>
        <div className="an-calib" ref={box} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <video ref={video} src={src} muted playsInline preload="auto" className="an-hidden-video" />
          <canvas ref={canvas} />
          {!ready && <div className="an-calib-wait small">Memuat frame…</div>}
          {quad.map((p, i) => (
            <button
              key={i}
              type="button"
              className={`an-handle${drag === i ? ' on' : ''}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              aria-label={CORNER_HINT[i]}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                setDrag(i);
              }}
              onPointerMove={move}
              onPointerUp={() => setDrag(null)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="tiny mute">1 kiri jauh · 2 kanan jauh · 3 kanan dekat · 4 kiri dekat (dilihat dari kamera)</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setQuad(DEFAULT_QUAD)}>
          Ulangi titik
        </button>
      </div>

      <div className="card stack">
        <h3>Siapa di dekat kamera?</h3>
        <Seg
          value={nearIsA ? 'a' : 'b'}
          onChange={(v) => setNearIsA(v === 'a')}
          options={[
            { v: 'a', label: 'Tim A' },
            { v: 'b', label: 'Tim B' },
          ]}
        />
        <div className="an-sides small">
          <div>
            <span className="eyebrow">Sisi jauh</span>
            <b>{farNames}</b>
          </div>
          <div>
            <span className="eyebrow">Dekat kamera</span>
            <b>{nearNames}</b>
          </div>
        </div>
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={onBack}>
          Kembali
        </button>
        <button className="btn btn-primary btn-lg grow" disabled={!ready} onClick={onNext}>
          Garis sudah pas, proses
        </button>
      </div>
    </div>
  );
}

/* ---------------- 3. Proses ---------------- */

function ProcessStep({
  video,
  setup,
  cal,
  start,
  end,
  names,
  onCancel,
  onDone,
}: {
  video: React.RefObject<HTMLVideoElement | null>;
  setup: Setup;
  cal: { sport: Sport; quad: Quad; aspect: number };
  start: number;
  end: number;
  names: string[];
  onCancel: () => void;
  onDone: (r: Result) => void;
}) {
  const [status, setStatus] = useState('Menyiapkan…');
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<string | null>(null);
  const pausedRef = useRef(false);
  const cancelled = useRef(false);
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    cancelled.current = false;
    let engine: Engine | null = null;
    let lock: { release(): Promise<void> } | null = null;
    (async () => {
      try {
        const v = video.current;
        if (!v) throw new Error('Video belum siap');
        if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
        try {
          lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
        } catch {
          /* tidak didukung */
        }
        engine = await loadEngine(setup.teamSize, setStatus);
        if (cancelled.current) return;
        setDelegate(engine.delegate);
        const proc = new FrameProcessor(engine, v, cal);
        const obs: FrameObs[] = [];
        const total = Math.max(1, Math.floor((end - start) * FPS));
        const t0 = performance.now();
        setStatus(`Melacak pemain, gerakan, dan ${cal.sport === 'padel' ? 'bola' : 'kok'}…`);
        for (let i = 0; i < total; i++) {
          while (pausedRef.current && !cancelled.current) await new Promise((r) => setTimeout(r, 200));
          if (cancelled.current) return;
          const t = start + i / FPS;
          await seek(v, t);
          const o = proc.process(t);
          obs.push(o);
          if (i % 3 === 0) {
            setProgress((i + 1) / total);
            const el = (performance.now() - t0) / 1000;
            setEta(i > 10 ? (el / (i + 1)) * (total - i - 1) : null);
            drawPreview(preview.current, v, o);
          }
        }
        setStatus('Menghitung pukulan…');
        setProgress(1);
        await new Promise((r) => setTimeout(r, 30));
        const calib = { sport: cal.sport, quad: cal.quad, aspect: cal.aspect };
        const tracks = trackPlayers(obs, calib, setup.teamSize);
        const shuttle = trackShuttle(obs, tracks, cal.aspect);
        const hits = detectHits(obs, tracks, shuttle, cal.sport, setup.teamSize);
        onDone({
          sport: cal.sport,
          teamSize: setup.teamSize,
          cal: calib,
          start,
          frames: obs.map((o) => ({ t: o.t })),
          tracks,
          shuttle,
          hits,
          names,
          weights: names.map(() => 65),
          title: setup.title,
        });
      } catch (e) {
        console.error(e);
        setError((e as Error).message || 'Gagal memproses video');
      } finally {
        engine?.close();
        lock?.release().catch(() => {});
      }
    })();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack-lg">
      <div className="card stack">
        <h3>{error ? 'Gagal memproses' : 'Sedang menganalisis'}</h3>
        {error ? (
          <div className="banner banner-danger">{error}</div>
        ) : (
          <p className="small mute">Biarkan layar menyala supaya proses tidak berhenti. Video tidak diunggah.</p>
        )}
        <canvas ref={preview} className="an-proc-preview" />
        <div className="an-bar">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="row-between small">
          <span>
            <b className="num">{Math.round(progress * 100)}%</b> <span className="mute">{status}</span>
          </span>
          {eta !== null && <span className="tiny mute num">sisa ±{mmss(eta)}</span>}
        </div>
        {delegate === 'CPU' && <div className="tiny mute">HP ini memakai mode CPU, proses lebih lama. Hasil tetap sama.</div>}
        <div className="row">
          <button
            className="btn btn-ghost grow"
            disabled={!!error}
            onClick={() => {
              pausedRef.current = !pausedRef.current;
              setPaused(pausedRef.current);
            }}
          >
            {paused ? 'Lanjutkan' : 'Jeda'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              cancelled.current = true;
              onCancel();
            }}
          >
            Hentikan
          </button>
        </div>
      </div>
    </div>
  );
}

function drawPreview(c: HTMLCanvasElement | null, v: HTMLVideoElement, o: FrameObs) {
  if (!c) return;
  const W = 480;
  const H = Math.round((W * v.videoHeight) / v.videoWidth) || 270;
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(v, 0, 0, W, H);
  ctx.fillStyle = 'rgba(14,23,20,0.25)';
  ctx.fillRect(0, 0, W, H);
  for (const p of o.poses) {
    ctx.strokeStyle = '#C6FF3D';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.box.x * W, p.box.y * H, p.box.w * W, p.box.h * H);
    ctx.fillStyle = '#C6FF3D';
    ctx.beginPath();
    ctx.arc(p.foot.x * W, p.foot.y * H, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  for (const b of o.blobs.slice(0, 12)) {
    ctx.beginPath();
    ctx.arc(b.x * W, b.y * H, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------- 4. Periksa ---------------- */

function ReviewStep({ src, r, setR, onBack, onNext }: { src: string; r: Result; setR: (r: Result) => void; onBack: () => void; onNext: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(r.start);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const locked = useRef(new Set<string>());
  const dt = frameDt(r.frames);
  const t0 = r.frames[0]?.t ?? r.start;
  const t1 = r.frames[r.frames.length - 1]?.t ?? r.start;
  const span = Math.max(1, t1 - t0);
  const PX = 56; // piksel per detik di timeline

  const redraw = useCallback(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c) return;
    const rect = v.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(rect.width * dpr)) c.width = Math.round(rect.width * dpr);
    if (c.height !== Math.round(rect.height * dpr)) c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawOverlay(ctx, r, frameAt(r, v.currentTime), 0, 0, c.width, c.height, { court: true, selectedHit: sel });
  }, [r, sel]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      setT(v.currentTime);
      if (v.currentTime >= t1) {
        v.pause();
      }
      redraw();
      if (!v.paused) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      loop();
    };
    const onSeeked = () => loop();
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadeddata', onSeeked);
    window.addEventListener('resize', redraw);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadeddata', onSeeked);
      window.removeEventListener('resize', redraw);
    };
  }, [redraw, t1]);

  useEffect(() => {
    const v = video.current;
    if (v) v.currentTime = r.start;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate]);
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Timeline mengikuti posisi putar.
  useEffect(() => {
    const s = strip.current;
    if (!s) return;
    const x = (t - t0) * PX;
    if (x < s.scrollLeft + 40 || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = x - s.clientWidth / 2;
  }, [t, t0]);

  const go = (time: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(t0, Math.min(t1, time));
  };
  const update = (fn: (r: Result) => void) => {
    const next: Result = { ...r, hits: r.hits.map((h) => ({ ...h })), tracks: [...r.tracks] };
    fn(next);
    classifyAll(next.hits, next.frames, next.tracks, next.shuttle, next.sport, next.teamSize, locked.current);
    setR(next);
  };
  const selected = r.hits.find((h) => h.id === sel) ?? null;
  const counts = r.names.map((_, i) => r.hits.filter((h) => h.player === i).length);

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row-between">
          <h3>Periksa pukulan</h3>
          <span className="chip tiny">{r.hits.length} pukulan</span>
        </div>
        <p className="small mute">
          Geser garis waktu. Ketuk tanda bulat untuk mengubah pemukul atau jenis pukulan. Ada pukulan terlewat? Berhenti di saat raket kena {r.sport === 'padel' ? 'bola' : 'kok'}, tekan <b>+</b>. Salah deteksi? Pilih lalu tekan <b>−</b>.
        </p>
        <div className="an-player">
          <video ref={video} src={src} playsInline muted preload="auto" onClick={() => (video.current?.paused ? video.current.play() : video.current?.pause())} />
          <canvas ref={canvas} />
          <div className="an-fab">
            <button className="an-fab-btn minus" disabled={!selected} aria-label="Hapus pukulan terpilih" onClick={() => selected && (update((n) => (n.hits = n.hits.filter((h) => h.id !== selected.id))), setSel(null))}>
              −
            </button>
            <button
              className="an-fab-btn plus"
              aria-label="Tambah pukulan di sini"
              onClick={() => {
                const fi = frameAt(r, t);
                const id = newHitId();
                update((n) => {
                  n.hits.push({ id, frame: fi, t: n.frames[fi].t, player: nearestPlayer(n.tracks, fi, n.shuttle[fi]), type: 'drive', auto: false });
                });
                setSel(id);
              }}
            >
              +
            </button>
          </div>
        </div>

        <div className="an-timeline" ref={strip}>
          <div className="an-track" style={{ width: span * PX + 32 }} onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            go(t0 + (e.clientX - rect.left - 16) / PX);
          }}>
            {Array.from({ length: Math.floor(span) + 1 }, (_, s) => (
              <span key={s} className="an-tick" style={{ left: 16 + s * PX }}>
                {s % 5 === 0 ? mmss(t0 + s) : ''}
              </span>
            ))}
            {r.hits.map((h) => (
              <button
                key={h.id}
                className={`an-mark${h.id === sel ? ' on' : ''}${h.auto ? '' : ' manual'}`}
                style={{ left: 16 + (h.t - t0) * PX, background: PLAYER_COLORS[h.player % 4] }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(h.id);
                  go(h.t);
                }}
                aria-label={`${r.names[h.player]} ${shotLabel(r.sport, h.type)}`}
              >
                {h.player + 1}
              </button>
            ))}
            <span className="an-head-line" style={{ left: 16 + (t - t0) * PX }} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => go(t - dt)} aria-label="Mundur 1 frame">
            ‹
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => go(t - 1)}>
            −1
          </button>
          <button className="btn btn-dark an-play" onClick={() => (playing ? video.current?.pause() : video.current?.play())} aria-label={playing ? 'Jeda' : 'Putar'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => go(t + 1)}>
            +1
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => go(t + dt)} aria-label="Maju 1 frame">
            ›
          </button>
          <button className="btn btn-ghost btn-sm num" onClick={() => setRate(rate === 1 ? 0.5 : rate === 0.5 ? 0.25 : 1)}>
            {rate}x
          </button>
        </div>
        <div className="center tiny mute num">{mmss(t, true)}</div>

        {selected ? (
          <div className="card card-surface stack" style={{ gap: 10 }}>
            <div className="row-between">
              <b>Pukulan di {mmss(selected.t, true)}</b>
              <span className="chip tiny">{selected.auto ? `Mesin · ${Math.round((selected.conf ?? 0) * 100)}%` : 'Manual'}</span>
            </div>
            <label className="field">
              <span className="label">Pemukul</span>
              <select
                className="select"
                value={selected.player}
                onChange={(e) =>
                  update((n) => {
                    const h = n.hits.find((x) => x.id === selected.id)!;
                    h.player = Number(e.target.value);
                  })
                }
              >
                {r.names.map((nm, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {nm}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Jenis pukulan</span>
              <select
                className="select"
                value={selected.type}
                onChange={(e) => {
                  locked.current.add(selected.id);
                  update((n) => {
                    const h = n.hits.find((x) => x.id === selected.id)!;
                    h.type = e.target.value as typeof h.type;
                  });
                }}
              >
                {SHOT_TYPES[r.sport].map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-danger btn-sm" onClick={() => (update((n) => (n.hits = n.hits.filter((h) => h.id !== selected.id))), setSel(null))}>
              Bukan pukulan
            </button>
          </div>
        ) : null}

        <div className="an-legend">
          {r.names.map((nm, i) => (
            <span key={i} className="an-legend-item small">
              <i style={{ background: PLAYER_COLORS[i % 4] }} />
              {i + 1}. {nm} <b className="num">{counts[i]}</b>
            </span>
          ))}
        </div>
        {r.teamSize === 2 && (
          <div className="row wrap" style={{ gap: 8 }}>
            {[0, 2].map((a) => (
              <button key={a} className="btn btn-ghost btn-xs" onClick={() => update((n) => swapSlots(n.tracks, n.hits, a, a + 1))}>
                <Swap size={14} /> Tukar {r.names[a]} ↔ {r.names[a + 1]}
              </button>
            ))}
          </div>
        )}
        <div className="tiny mute">Label nama tertukar? Tekan tukar supaya posisi & pukulan pindah ke pemain yang benar.</div>
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={onBack}>
          Ulangi lapangan
        </button>
        <button className="btn btn-primary btn-lg grow" onClick={onNext}>
          Sudah benar, lihat hasil
        </button>
      </div>
    </div>
  );
}

/* ---------------- 5. Hasil ---------------- */

function ResultStep({
  src,
  r,
  setR,
  patch,
  end,
  onBack,
  from,
}: {
  src: string;
  r: Result;
  setR: (r: Result) => void;
  patch: (x: Partial<Result>) => void;
  end: number; onBack: () => void; from?: Setup['from'] }) {
  const toast = useToast();
  const st = useMemo(() => summarize(r.frames, r.tracks, r.hits, r.sport, r.teamSize, r.weights), [r]);
  const [layout, setLayout] = useState<'portrait' | 'landscape'>('portrait');
  const [showKcal, setShowKcal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [out, setOut] = useState<{ url: string; blob: Blob; mime: string } | null>(null);
  const signal = useRef({ cancelled: false });
  const heat = useRef<HTMLCanvasElement>(null);
  const supported = !!recorderMime();

  useEffect(() => () => void (out && URL.revokeObjectURL(out.url)), [out]);

  useEffect(() => {
    const c = heat.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawMiniCourt(ctx, { ...r, tracks: [] }, 0, 0, 0, c.width, c.height);
    const spec = COURTS[r.sport];
    const s = Math.min((c.width - 20) / spec.W, (c.height - 20) / spec.L);
    const ox = (c.width - spec.W * s) / 2;
    const oy = (c.height - spec.L * s) / 2;
    r.tracks.forEach((t, i) => {
      ctx.fillStyle = PLAYER_COLORS[i % 4] + '33';
      smoothCourt(t).forEach((p, k) => {
        if (!p || k % 2) return;
        ctx.beginPath();
        ctx.arc(ox + p.x * s, oy + p.y * s, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }, [r]);

  const make = async () => {
    let audio: AudioContext | null = null;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      audio = AC ? new AC() : null;
    } catch {
      audio = null;
    }
    signal.current = { cancelled: false };
    setBusy(true);
    setProg(0);
    if (out) URL.revokeObjectURL(out.url);
    setOut(null);
    try {
      const res = await exportVideo({ src, r, layout, showKcal, end, onProgress: setProg, signal: signal.current, audio });
      setOut({ url: URL.createObjectURL(res.blob), ...res });
    } catch (e) {
      if ((e as Error).message !== 'Dibatalkan') toast((e as Error).message, true);
    } finally {
      setBusy(false);
      audio?.close().catch(() => {});
    }
  };

  const ext = out?.mime.includes('mp4') ? 'mp4' : 'webm';
  const fileName = `ai-match-analysis-${layout === 'portrait' ? '9x16' : '16x9'}.${ext}`;
  const share = async () => {
    if (!out) return;
    const file = new File([out.blob], fileName, { type: out.blob.type });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'AI Match Analysis · Wins Court' });
      } catch {
        /* dibatalkan */
      }
    } else download();
  };
  const download = () => {
    if (!out) return;
    const a = document.createElement('a');
    a.href = out.url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="stack-lg">
      <div className="card card-dark stack">
        <div className="row-between">
          <div>
            <div className="eyebrow" style={{ color: 'var(--lime)' }}>
              Hasil analisis
            </div>
            <div className="small" style={{ opacity: 0.75 }}>
              {mmss(st.duration)} video · {r.hits.length} pukulan · {st.rallies} reli
            </div>
          </div>
          <span className="beta-tag dark">BETA</span>
        </div>
        <div className="an-kpis">
          <div>
            <b className="num">{r.hits.length}</b>
            <span>pukulan</span>
          </div>
          <div>
            <b className="num">{st.rallies}</b>
            <span>reli</span>
          </div>
          <div>
            <b className="num">{st.longestRally}</b>
            <span>reli terpanjang</span>
          </div>
        </div>
      </div>

      {st.players.some((p) => p.coverage < 40) && (
        <div className="banner banner-warn small">
          Sebagian pemain jarang terlacak, jadi jarak & kalori bisa terlalu kecil. Pastikan seluruh badan pemain terlihat, kamera diam, dan keempat titik
          lapangan pas.
        </div>
      )}

      <div className="an-players">
        {st.players.map((p, i) => (
          <div key={i} className="card stack" style={{ gap: 10 }}>
            <div className="row-between">
              <span className="row" style={{ gap: 8 }}>
                <i className="an-dot" style={{ background: PLAYER_COLORS[i % 4] }} />
                <b>{r.names[i]}</b>
              </span>
              <span className="tiny mute">{i < r.teamSize ? 'dekat kamera' : 'sisi jauh'}</span>
            </div>
            <div className="an-stat3">
              <div>
                <b className="num">{p.hits}</b>
                <span>pukulan</span>
              </div>
              <div>
                <b className="num">{fmt1(p.distance)}</b>
                <span>meter lari</span>
              </div>
              <div>
                <b className="num">{fmt1(p.kcal)}</b>
                <span>
                  kkal ·{' '}
                  <input
                    className="an-weight num"
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={150}
                    value={r.weights[i]}
                    onChange={(e) => {
                      const w = [...r.weights];
                      w[i] = Math.max(30, Math.min(150, Number(e.target.value) || 65));
                      setR({ ...r, weights: w });
                    }}
                    aria-label="Berat badan (kg)"
                  />
                  kg
                </span>
              </div>
            </div>
            <div className="an-zones">
              <span style={{ width: `${p.zones.depan}%` }} className="z1" />
              <span style={{ width: `${p.zones.tengah}%` }} className="z2" />
              <span style={{ width: `${p.zones.belakang}%` }} className="z3" />
            </div>
            <div className="tiny mute row wrap" style={{ gap: 10 }}>
              <span>
                <i className="an-zdot z1" /> Depan {Math.round(p.zones.depan)}%
              </span>
              <span>
                <i className="an-zdot z2" /> Tengah {Math.round(p.zones.tengah)}%
              </span>
              <span>
                <i className="an-zdot z3" /> Belakang {Math.round(p.zones.belakang)}%
              </span>
            </div>
            {p.hits > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                {Object.entries(p.byType).map(([k, n]) => (
                  <span key={k} className="chip tiny">
                    {shotLabel(r.sport, k as never)} <b>{n}</b>
                  </span>
                ))}
              </div>
            )}
            <div className="tiny whisper">
              Kecepatan maks {fmt1(p.maxSpeed)} m/s · terlacak {Math.round(p.coverage)}% waktu
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h3>Peta gerak</h3>
        <canvas ref={heat} width={220} height={r.sport === 'badminton' ? 440 : 420} className="an-heat" />
        <div className="an-legend center" style={{ justifyContent: 'center' }}>
          {r.names.map((nm, i) => (
            <span key={i} className="an-legend-item small">
              <i style={{ background: PLAYER_COLORS[i % 4] }} />
              {nm}
            </span>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h3>Simpan video</h3>
        <RankingPicker r={r} patch={patch} from={from} />
        <p className="small mute">Video dengan nama pemain, label pukulan & statistik bergaya Wins Court — siap untuk Instagram, TikTok, atau WhatsApp.</p>
        <Seg
          value={layout}
          onChange={setLayout}
          options={[
            { v: 'portrait', label: 'Reels 9:16' },
            { v: 'landscape', label: 'Lebar 16:9' },
          ]}
        />
        <Switch on={showKcal} onChange={setShowKcal} label="Tampilkan kalori" hint="Perkiraan dari jarak lari & berat badan" />
        {!supported && <div className="banner banner-warn small">Browser ini belum mendukung perekaman video. Coba Chrome atau Safari versi terbaru.</div>}
        {busy ? (
          <>
            <div className="an-bar">
              <span style={{ width: `${Math.round(prog * 100)}%` }} />
            </div>
            <div className="row-between small">
              <span className="mute">Merekam video… jangan tutup halaman</span>
              <button className="btn btn-ghost btn-xs" onClick={() => (signal.current.cancelled = true)}>
                Batal
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={!supported} onClick={make}>
            Buat video {layout === 'portrait' ? '9:16' : '16:9'}
          </button>
        )}
        {out && (
          <div className="stack">
            <video src={out.url} controls playsInline className={`an-out ${layout}`} />
            <div className="tiny mute center">
              {(out.blob.size / 1_048_576).toFixed(1).replace('.', ',')} MB · {ext.toUpperCase()}
            </div>
            <div className="row">
              <button className="btn btn-ghost grow" onClick={download}>
                <Download size={18} /> Unduh
              </button>
              <button className="btn btn-dark grow" onClick={share}>
                <Share size={18} /> Bagikan
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={onBack}>
          Periksa lagi
        </button>
        {from ? (
          <Link className="btn btn-dark grow" to={`/s/${from.slug}`}>
            Kembali ke sesi
          </Link>
        ) : (
          <Link className="btn btn-dark grow" to="/">
            Ke beranda
          </Link>
        )}
      </div>
      <p className="tiny whisper center">
        Beta: angka adalah perkiraan mesin dari video dan bisa meleset, terutama bila pemain tertutup atau kamera bergerak.
      </p>
    </div>
  );
}

/* ---------------- peringkat sesi untuk overlay video ---------------- */

const norm = (s: string) => s.trim().toLowerCase().replace(/s+/g, ' ');

function RankingPicker({ r, patch, from }: { r: Result; patch: (x: Partial<Result>) => void; from?: Setup['from'] }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [on, setOn] = useState(false);
  const [slug, setSlug] = useState<string>(from?.slug ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => new Set(r.names.map(norm)), [r.names]);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        const list = [...m.sessions].sort((a, b) => b.start.localeCompare(a.start));
        setSessions(list);
        setSlug((cur) => cur || list[0]?.slug || '');
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (!on || !slug) {
      patch({ ranking: null });
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .session(slug)
      .then(({ session: s }) => {
        if (!alive) return;
        const rows = playerStandings(s).map((x, i) => ({
          rank: i + 1,
          name: x.name,
          played: x.played,
          won: x.won,
          lost: x.lost,
          total: x.total,
          inMatch: names.has(norm(x.name)),
        }));
        const ranking: Ranking = { session: s.name, sortBy: s.settings.sortBy === 'wins' ? 'wins' : 'points', rows };
        patch({ ranking });
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, slug, names]);

  const rk = r.ranking;
  const shown = 5;
  return (
    <div className="stack an-rank-pick">
      <Switch on={on} onChange={setOn} label="Tampilkan peringkat di video" hint="5 besar dari sesi milikmu (opsional)" />
      {on && (
        <label className="field">
          <span className="label">Ambil dari sesi</span>
          <select className="select" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!sessions}>
            {(sessions ?? []).map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} · {new Date(s.start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        </label>
      )}
      {on && sessions && sessions.length === 0 && <div className="tiny mute">Belum ada sesi milikmu. Buat sesi dulu supaya peringkatnya bisa ditampilkan di video.</div>}
      {loading && <div className="tiny mute">Memuat peringkat…</div>}
      {error && <div className="banner banner-danger small">{error}</div>}
      {on && rk && !loading && (
        <>
          {rk.rows.length === 0 ? (
            <div className="tiny mute">Sesi ini belum punya pertandingan selesai.</div>
          ) : (
            <ol className="an-rank">
              {rk.rows.slice(0, shown).map((x) => (
                <li key={x.rank} className={x.inMatch ? 'me' : ''}>
                  <span className={`an-rank-n${x.rank <= 3 ? ' top' : ''}`}>{x.rank}</span>
                  <span className="grow">{x.name}</span>
                  <span className="tiny mute num">
                    {x.won}-{x.lost}
                  </span>
                  <b className="num">{rk.sortBy === 'wins' ? x.won : x.total}</b>
                </li>
              ))}
            </ol>
          )}
          <div className="tiny mute">Nama pemain match ini ditandai lime. Bila di luar 5 besar, tetap ditampilkan di baris terakhir video.</div>
        </>
      )}
    </div>
  );
}
