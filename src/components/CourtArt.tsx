import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Lapangan tampak atas yang menggambar sendiri, dengan pemain dan reli yang bergerak.
 * - Ganda: 2 pemain per sisi, kok/bola berpindah antar 4 pemain (silang & lurus).
 * - Tunggal (badminton): 1 lawan 1, area tunggal (garis samping dalam) disorot.
 * - Badminton: shuttlecock melambung, gabus di depan. Padel: bola memantul di lantai, sesekali kena kaca belakang.
 * Setiap pukulan memberi denyut di pemain yang memukul. Mengikuti prefers-reduced-motion.
 */

type Pt = [number, number];
type Sport = 'badminton' | 'padel';
export interface CourtPlayer {
  name: string;
  level?: number;
}

const LEVEL = [
  { name: 'Pemula', bg: '#dcfce7', fg: '#15803d' },
  { name: 'Menengah', bg: '#fef3c7', fg: '#a16207' },
  { name: 'Mahir', bg: '#dbeafe', fg: '#1d4ed8' },
  { name: 'Pro', bg: '#0e1714', fg: '#c6ff3d' },
];
const cleanName = (n: string) => n.replace(/^\s*\d+[.)]\s*/, '');

interface Props {
  sport: Sport;
  teamSize?: 1 | 2;
  /** Pemain tim A (kiri) & B (kanan): nama + level. Kosong = penanda tanpa label. */
  a?: CourtPlayer[];
  b?: CourtPlayer[];
  animate?: boolean;
  glow?: boolean;
  height?: number;
  /** Status match: idle = dekorasi, scheduled = siap mulai, live = reli, done = pemenang disorot. */
  state?: CourtState;
  /** Skor tampil di lapangan + kilatan +1 saat bertambah. */
  score?: { a: number; b: number } | null;
  /** Tim yang servis & poinnya (untuk posisi servis kanan/kiri). */
  server?: 'a' | 'b';
  serverPoints?: number;
  /** Tim ditukar sisi oleh wasit. */
  swapped?: boolean;
  winner?: 'a' | 'b' | 'draw' | null;
  /** Tampilkan pemain di lapangan (default true). */
  players?: boolean;
}

const initials = (name?: string) =>
  (name ?? '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/* ---------------- geometri ---------------- */

const qPoint = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => [
  (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p1[0],
  (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p1[1],
];
function qLen(p0: Pt, c: Pt, p1: Pt): number {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 16; i++) {
    const p = qPoint(p0, c, p1, i / 16);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

interface Seg {
  to: Pt;
  /** Tinggi lambungan (dalam unit tampak atas, digeser ke atas layar). */
  lift: number;
  /** Bagian waktu satu pukulan yang dipakai segmen ini. */
  share: number;
}

/** Bangun path kurva + keyPoints/keyTimes agar tiap pukulan berdurasi sama. */
function buildFlight(start: Pt, shots: Seg[][]) {
  let d = `M${start[0]} ${start[1]}`;
  let shadow = `M${start[0]} ${start[1] + 6}`;
  const lens: number[] = [];
  const sLens: number[] = [];
  const times: number[] = [];
  let cur = start;
  shots.forEach((segs, i) => {
    let t = i / shots.length;
    for (const s of segs) {
      const mid: Pt = [(cur[0] + s.to[0]) / 2, (cur[1] + s.to[1]) / 2 - s.lift];
      d += ` Q${mid[0]} ${mid[1]} ${s.to[0]} ${s.to[1]}`;
      shadow += ` L${s.to[0]} ${s.to[1] + 6}`;
      lens.push(qLen(cur, mid, s.to));
      sLens.push(Math.hypot(s.to[0] - cur[0], s.to[1] - cur[1]));
      t += s.share / shots.length;
      times.push(t);
      cur = s.to;
    }
  });
  const cum = (arr: number[]) => {
    const total = arr.reduce((x, y) => x + y, 0) || 1;
    let acc = 0;
    return [0, ...arr.map((x) => (acc += x) / total)].map((x) => Math.min(1, x).toFixed(4)).join(';');
  };
  const keyTimes = [0, ...times].map((x) => Math.min(1, x).toFixed(4)).join(';');
  return { d, shadow, keyPoints: cum(lens), shadowKeyPoints: cum(sLens), keyTimes };
}

/* ---------------- posisi pemain ---------------- */

function positions(sport: Sport, size: 1 | 2): { A: Pt[]; B: Pt[] } {
  if (sport === 'padel')
    return size === 1
      ? { A: [[78, 75]], B: [[222, 75]] }
      : {
          A: [
            [78, 44],
            [78, 106],
          ],
          B: [
            [222, 44],
            [222, 106],
          ],
        };
  return size === 1
    ? { A: [[70, 75]], B: [[230, 75]] }
    : {
        A: [
          [74, 46],
          [74, 104],
        ],
        B: [
          [226, 46],
          [226, 104],
        ],
      };
}

/** Urutan pukulan: ganda bergantian silang & lurus antar 4 pemain; tunggal bolak-balik dengan variasi arah. */
function rally(sport: Sport, size: 1 | 2, serve: { side: 'A' | 'B'; i: number } = { side: 'A', i: 0 }) {
  const { A, B } = positions(sport, size);
  const off = (p: Pt, dx: number, dy = 0): Pt => [p[0] + dx, p[1] + dy];
  // Titik pukul sedikit di depan pemain (ke arah net).
  const hitA = (i: number, dy = 0) => off(A[i], 10, dy);
  const hitB = (i: number, dy = 0) => off(B[i], -10, dy);
  const base: { side: 'A' | 'B'; i: number; dy: number }[] =
    size === 2
      ? [
          { side: 'A', i: 0, dy: 0 },
          { side: 'B', i: 1, dy: 0 },
          { side: 'A', i: 1, dy: 0 },
          { side: 'B', i: 0, dy: 0 },
        ]
      : [
          { side: 'A', i: 0, dy: 0 },
          { side: 'B', i: 0, dy: -18 },
          { side: 'A', i: 0, dy: 16 },
          { side: 'B', i: 0, dy: 14 },
        ];
  // Reli dimulai dari pemain yang sedang servis.
  const k0 = Math.max(0, base.findIndex((o) => o.side === serve.side && o.i === serve.i));
  const order = [...base.slice(k0), ...base.slice(0, k0)].map((o, k) => (k === 0 ? { ...o, dy: 0 } : o));
  const pt = (o: (typeof order)[number]) => (o.side === 'A' ? hitA(o.i, o.dy) : hitB(o.i, o.dy));
  const start = pt(order[0]);
  const shots: Seg[][] = order.map((_, k) => {
    const next = order[(k + 1) % order.length];
    const to = pt(next);
    if (sport === 'badminton') return [{ to, lift: 46, share: 1 }];
    // Padel: lambung lewat net, pantul di lantai dekat penerima, lalu naik ke raket.
    const toRight = next.side === 'B';
    const bounce: Pt = [to[0] + (toRight ? -26 : 26), to[1] + (k % 2 ? 8 : -8)];
    // Satu dari empat pukulan memantul ke kaca belakang dulu.
    if (k === 1) {
      const glass: Pt = [toRight ? 274 : 26, to[1] + 6];
      return [
        { to: bounce, lift: 30, share: 0.5 },
        { to: glass, lift: 8, share: 0.2 },
        { to, lift: 8, share: 0.3 },
      ];
    }
    return [
      { to: bounce, lift: 30, share: 0.65 },
      { to, lift: 10, share: 0.35 },
    ];
  });
  return { start, shots, order, A, B };
}

/* ---------------- komponen ---------------- */

export type CourtState = 'idle' | 'scheduled' | 'live' | 'done';

/** Posisi server: ganda berpindah kanan-kiri mengikuti ganjil/genap poin tim yang servis. */
function servePos(size: 1 | 2, side: 'A' | 'B', points: number): { side: 'A' | 'B'; i: number } {
  if (size === 1) return { side, i: 0 };
  const even = points % 2 === 0;
  // Tim kiri menghadap ke kanan: sisi kanan pemain = bawah. Tim kanan menghadap ke kiri: sisi kanan = atas.
  return { side, i: side === 'A' ? (even ? 1 : 0) : even ? 0 : 1 };
}

export function CourtArt({
  sport,
  teamSize = 2,
  a,
  b,
  animate = true,
  glow,
  height,
  players = true,
  state = 'idle',
  score,
  server = 'a',
  serverPoints = 0,
  swapped = false,
  winner = null,
}: Props) {
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const size: 1 | 2 = sport === 'padel' ? (teamSize === 1 ? 1 : 2) : teamSize;
  // Sisi tampilan: A = kiri, B = kanan. Tukar sisi dari wasit membalik tim.
  const left = swapped ? b : a;
  const right = swapped ? a : b;
  const leftTeam: 'a' | 'b' = swapped ? 'b' : 'a';
  const sideOf = (t: 'a' | 'b'): 'A' | 'B' => (t === leftTeam ? 'A' : 'B');
  const serve = servePos(size, sideOf(server), serverPoints);
  const winSide = winner === 'a' || winner === 'b' ? sideOf(winner) : null;
  const rallying = animate && !reduced && (state === 'live' || state === 'idle');
  const r = useMemo(() => rally(sport, size, serve), [sport, size, serve.side, serve.i]); // eslint-disable-line react-hooks/exhaustive-deps
  const flight = useMemo(() => buildFlight(r.start, r.shots), [r]);
  const dur = sport === 'padel' ? 4.4 : 3.6;
  const delay = 1.0;
  const style = height ? { height, width: '100%' } : { width: '100%', height: 'auto', aspectRatio: '2 / 1' };

  // Kilatan +1 di sisi yang mencetak poin.
  const prev = useRef(score);
  const [flash, setFlash] = useState<{ side: 'A' | 'B'; n: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = score;
    if (!p || !score) return;
    const side = score.a > p.a ? 'a' : score.b > p.b ? 'b' : null;
    if (side) setFlash({ side: sideOf(side), n: Date.now() });
  }, [score?.a, score?.b]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  const shownLeft = score ? (leftTeam === 'a' ? score.a : score.b) : null;
  const shownRight = score ? (leftTeam === 'a' ? score.b : score.a) : null;

  return (
    <div className="court-wrap">
      <svg className={`court-art${glow ? ' glow' : ''}`} viewBox="0 0 300 150" style={style} preserveAspectRatio="xMidYMid meet" aria-hidden>
        {sport === 'badminton' ? <BadmintonLines singles={size === 1} /> : <PadelLines />}

        {players &&
          (['A', 'B'] as const).map((side) =>
            (side === 'A' ? r.A : r.B).map((p, i) => {
              const pl = (side === 'A' ? left : right)?.[i];
              const name = pl?.name;
              const hitIndex = r.order.findIndex((o) => o.side === side && o.i === i);
              const isServer = state === 'scheduled' || state === 'live' ? serve.side === side && serve.i === i : false;
              const dim = !!winSide && winSide !== side;
              const won = winSide === side;
              const team: 'a' | 'b' = side === 'A' ? leftTeam : leftTeam === 'a' ? 'b' : 'a';
              return (
                <g key={`${side}${i}`} className="court-player" style={{ animationDelay: `${0.4 + i * 0.1}s`, opacity: dim ? 0.4 : 1 }}>
                  {rallying && hitIndex >= 0 && (
                    <circle cx={p[0]} cy={p[1]} r="10" fill="none" stroke={team === 'a' ? 'var(--mint)' : 'var(--lime-deep)'} strokeWidth="1.5" opacity="0">
                      <animate attributeName="r" values="10;19;19" keyTimes="0;0.12;1" dur={`${dur}s`} begin={`${delay + (hitIndex / r.order.length) * dur}s`} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.9;0;0" keyTimes="0;0.12;1" dur={`${dur}s`} begin={`${delay + (hitIndex / r.order.length) * dur}s`} repeatCount="indefinite" />
                    </circle>
                  )}
                  {won && <circle cx={p[0]} cy={p[1]} r="14" fill="var(--lime)" opacity="0.45" />}
                  <ellipse cx={p[0]} cy={p[1] + 10} rx="9" ry="2.6" fill="var(--text)" opacity="0.12" />
                  <circle cx={p[0]} cy={p[1]} r="10" fill={team === 'a' ? 'var(--mint)' : 'var(--lime)'} stroke={isServer ? 'var(--text)' : 'var(--card)'} strokeWidth="2" />
                  <text x={p[0]} y={p[1] + 3.2} textAnchor="middle" fontSize={name ? 8.5 : 0} fontWeight="800" fontFamily="var(--display)" fill="var(--on-lime)">
                    {initials(name)}
                  </text>
                  {isServer && (
                    <g>
                      <circle cx={p[0] + 9} cy={p[1] - 9} r="5" fill="var(--text)" />
                      <text x={p[0] + 9} y={p[1] - 6.8} textAnchor="middle" fontSize="6.5" fontWeight="800" fontFamily="var(--display)" fill="var(--lime)">
                        S
                      </text>
                    </g>
                  )}
                  {pl && <PlayerLabel x={p[0]} y={p[1] + 16} side={side} pl={pl} />}
                </g>
              );
            }),
          )}

        {/* Siap mulai: kok/bola diam di tangan server */}
        {players && state === 'scheduled' && (
          <g transform={`translate(${r.start[0] + (serve.side === 'A' ? 8 : -8)} ${r.start[1] - 6})`}>{sport === 'badminton' ? <ShuttleShape rotate={serve.side === 'A' ? 0 : 180} /> : <BallShape />}</g>
        )}

        {rallying && (
          <g key={`${serve.side}${serve.i}`} opacity="0">
            <animate attributeName="opacity" from="0" to="1" begin={`${delay}s`} dur="0.3s" fill="freeze" />
            <ellipse rx={sport === 'padel' ? 4.5 : 5.5} ry="1.8" fill="var(--text)" opacity="0.16">
              <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={flight.shadow} keyPoints={flight.shadowKeyPoints} keyTimes={flight.keyTimes} calcMode="linear" />
            </ellipse>
            {sport === 'badminton' ? (
              <g>
                <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" rotate="auto" path={flight.d} keyPoints={flight.keyPoints} keyTimes={flight.keyTimes} calcMode="linear" />
                <ShuttleShape />
              </g>
            ) : (
              <g>
                <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={flight.d} keyPoints={flight.keyPoints} keyTimes={flight.keyTimes} calcMode="linear" />
                <g>
                  <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.6s" repeatCount="indefinite" />
                  <BallShape />
                </g>
              </g>
            )}
          </g>
        )}
      </svg>

      {shownLeft !== null && (
        <div className="court-score num">
          <span>{shownLeft}</span>
          <i>:</i>
          <span>{shownRight}</span>
        </div>
      )}
      {flash && (
        <span key={flash.n} className={`court-flash ${flash.side === 'A' ? 'left' : 'right'}`}>
          +1
        </span>
      )}
    </div>
  );
}

function ShuttleShape({ rotate = 0 }: { rotate?: number }) {
  return (
    <g transform={`rotate(${rotate})`}>
      <path d="M-10 -5 L1 -2.2 L1 2.2 L-10 5 Z" fill="var(--card)" stroke="var(--text)" strokeWidth="1" strokeLinejoin="round" />
      <path d="M-10 -2.5 L1 -1.1 M-10 0 L1 0 M-10 2.5 L1 1.1" stroke="var(--text)" strokeWidth="0.55" opacity="0.5" />
      <circle cx="3.4" cy="0" r="3.1" fill="var(--text)" />
    </g>
  );
}

function BallShape() {
  return (
    <g>
      <circle r="4.6" fill="var(--lime)" stroke="var(--on-lime)" strokeWidth="0.9" />
      <path d="M-3.2 -3.2 C-0.9 -0.9 -0.9 0.9 -3.2 3.2 M3.2 -3.2 C0.9 -0.9 0.9 0.9 3.2 3.2" fill="none" stroke="var(--on-lime)" strokeWidth="0.75" />
    </g>
  );
}

/** Label di bawah pemain: pil nama + pil level (urutan dibalik untuk tim kanan, seperti Kourt). */
function PlayerLabel({ x, y, side, pl }: { x: number; y: number; side: 'A' | 'B'; pl: CourtPlayer }) {
  const name = cleanName(pl.name).slice(0, 12);
  const lv = LEVEL[(pl.level ?? 1) - 1] ?? LEVEL[0];
  const fs = 7.4;
  const nameW = name.length * fs * 0.56 + 8;
  const lvW = pl.level ? lv.name.length * fs * 0.52 + 8 : 0;
  const gap = pl.level ? 2 : 0;
  const total = nameW + gap + lvW;
  const x0 = x - total / 2;
  const pills =
    side === 'A'
      ? [
          { w: nameW, kind: 'name' as const },
          { w: lvW, kind: 'level' as const },
        ]
      : [
          { w: lvW, kind: 'level' as const },
          { w: nameW, kind: 'name' as const },
        ];
  let cx = x0;
  return (
    <g>
      {pills.map((pp) => {
        if (!pp.w) return null;
        const px = cx;
        cx += pp.w + gap;
        const isName = pp.kind === 'name';
        return (
          <g key={pp.kind}>
            <rect x={px} y={y} width={pp.w} height="11" rx="5.5" fill={isName ? 'var(--card)' : lv.bg} stroke={isName ? 'var(--hairline)' : 'none'} strokeWidth="0.6" />
            <text
              x={px + pp.w / 2}
              y={y + 7.9}
              textAnchor="middle"
              fontSize={fs}
              fontWeight={isName ? 700 : 600}
              fontFamily="var(--font)"
              fill={isName ? 'var(--text)' : lv.fg}
            >
              {isName ? name : lv.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* Skala 20 unit = 1 m. Lapangan 13,4 × 6,1 m di x 16–284, y 14–136. */
function BadmintonLines({ singles }: { singles: boolean }) {
  return (
    <g>
      <rect x="16" y="14" width="268" height="122" rx="2" fill="var(--mint)" fillOpacity="0.05" />
      {/* area main yang berlaku: tunggal = garis samping dalam s.d. garis belakang; ganda = penuh */}
      {singles ? (
        <rect x="16" y="23.2" width="268" height="103.6" fill="var(--mint)" fillOpacity="0.1" />
      ) : (
        <rect x="16" y="14" width="268" height="122" rx="2" fill="var(--mint)" fillOpacity="0.07" />
      )}
      <rect className="line" pathLength={1} x="16" y="14" width="268" height="122" rx="2" />
      <path className={`line${singles ? ' line-strong' : ''}`} pathLength={1} d="M16 23.2H284M16 126.8H284" />
      <path className="line" pathLength={1} d="M110.4 14V136M189.6 14V136" />
      <path className={`line${singles ? ' line-faint' : ''}`} pathLength={1} d="M31.2 14V136M268.8 14V136" />
      <path className="line" pathLength={1} d="M16 75H110.4M189.6 75H284" />
      <path className="line net" pathLength={1} d="M150 8V142" />
      <circle cx="150" cy="8" r="2.2" fill="var(--lime-deep)" />
      <circle cx="150" cy="142" r="2.2" fill="var(--lime-deep)" />
    </g>
  );
}

/* Skala 13 unit = 1 m. Lapangan 20 × 10 m di x 20–280, y 10–140. */
function PadelLines() {
  return (
    <g>
      <rect x="20" y="10" width="260" height="130" rx="4" fill="var(--lime)" fillOpacity="0.1" />
      <path d="M46 10H20V140H46M254 10H280V140H254" fill="none" stroke="var(--mint)" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" />
      <path d="M46 10H254M46 140H254" fill="none" stroke="var(--text)" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="3 3" />
      <rect className="line" pathLength={1} x="20" y="10" width="260" height="130" rx="4" />
      <path className="line" pathLength={1} d="M59.65 10V140M240.35 10V140" />
      <path className="line" pathLength={1} d="M59.65 75H240.35" />
      <path className="line net" pathLength={1} d="M150 4V146" />
      <circle cx="150" cy="4" r="2.4" fill="var(--lime-deep)" />
      <circle cx="150" cy="146" r="2.4" fill="var(--lime-deep)" />
    </g>
  );
}
