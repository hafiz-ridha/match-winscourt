/**
 * Analisis reli — inti murni (tanpa DOM): geometri lapangan, pelacakan pemain & kok,
 * deteksi pukulan, klasifikasi jenis pukulan, dan statistik per pemain.
 * Koordinat gambar dinormalisasi 0..1; koordinat lapangan dalam meter:
 *   x = lebar (0 kiri → W kanan, dilihat dari kamera), y = panjang (0 baseline jauh → L baseline dekat).
 */

export type Sport = 'badminton' | 'padel';
export interface Pt {
  x: number;
  y: number;
}
export type Quad = [Pt, Pt, Pt, Pt]; // jauh-kiri, jauh-kanan, dekat-kanan, dekat-kiri

export interface CourtSpec {
  sport: Sport;
  W: number;
  L: number;
  /** Garis tambahan (meter) untuk pratinjau kalibrasi: jarak garis servis dari net. */
  serviceFromNet: number;
  /** Jarak garis servis panjang ganda dari baseline (badminton 0.76 m), 0 = tidak ada. */
  longServiceFromBase: number;
  /** Garis tengah servis membagi dua sisi (bukan di area depan net untuk badminton). */
  centerFromNet: number;
}

/** Jeda tanpa pukulan (detik) yang dianggap reli baru. Padel lebih lama: lob & pantulan dinding kaca. */
export const RALLY_GAP: Record<Sport, number> = { badminton: 2.5, padel: 3.5 };

export const COURTS: Record<Sport, CourtSpec> = {
  badminton: { sport: 'badminton', W: 6.1, L: 13.4, serviceFromNet: 1.98, longServiceFromBase: 0.76, centerFromNet: 1.98 },
  padel: { sport: 'padel', W: 10, L: 20, serviceFromNet: 6.95, longServiceFromBase: 0, centerFromNet: 0 },
};

/* ---------------- homografi ---------------- */

export type H = number[]; // 3x3 baris-utama, h[8] = 1

/** Homografi dari 4 titik src → dst (DLT, eliminasi Gauss 8x8). */
export function homography(src: Pt[], dst: Pt[]): H {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((r) => r[8]), 1];
}

export function apply(h: H, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export interface Calib {
  sport: Sport;
  quad: Quad;
  /** Rasio lebar/tinggi frame video (untuk jarak di gambar). */
  aspect: number;
}

export function courtCorners(c: CourtSpec): Quad {
  return [
    { x: 0, y: 0 },
    { x: c.W, y: 0 },
    { x: c.W, y: c.L },
    { x: 0, y: c.L },
  ];
}

/** Gambar→lapangan dan lapangan→gambar. */
export function calibMaps(cal: Calib) {
  const spec = COURTS[cal.sport];
  const toCourt = homography(cal.quad, courtCorners(spec));
  const toImage = homography(courtCorners(spec), cal.quad);
  return { spec, toCourt: (p: Pt) => apply(toCourt, p), toImage: (p: Pt) => apply(toImage, p) };
}

/** Garis-garis lapangan (meter) untuk digambar sebagai pratinjau kalibrasi. */
export function courtLines(spec: CourtSpec): [Pt, Pt][] {
  const { W, L } = spec;
  const net = L / 2;
  const lines: [Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }],
    [{ x: W, y: 0 }, { x: W, y: L }],
    [{ x: W, y: L }, { x: 0, y: L }],
    [{ x: 0, y: L }, { x: 0, y: 0 }],
    [{ x: 0, y: net }, { x: W, y: net }],
    [{ x: 0, y: net - spec.serviceFromNet }, { x: W, y: net - spec.serviceFromNet }],
    [{ x: 0, y: net + spec.serviceFromNet }, { x: W, y: net + spec.serviceFromNet }],
  ];
  if (spec.sport === 'badminton') {
    const side = 0.46;
    lines.push(
      [{ x: side, y: 0 }, { x: side, y: L }],
      [{ x: W - side, y: 0 }, { x: W - side, y: L }],
      [{ x: 0, y: spec.longServiceFromBase }, { x: W, y: spec.longServiceFromBase }],
      [{ x: 0, y: L - spec.longServiceFromBase }, { x: W, y: L - spec.longServiceFromBase }],
      [{ x: W / 2, y: 0 }, { x: W / 2, y: net - spec.serviceFromNet }],
      [{ x: W / 2, y: net + spec.serviceFromNet }, { x: W / 2, y: L }],
    );
  } else {
    lines.push([{ x: W / 2, y: net - spec.serviceFromNet }, { x: W / 2, y: net + spec.serviceFromNet }]);
  }
  return lines;
}

/** Kotak (gambar, ternormalisasi) yang mencakup satu sisi lapangan + ruang tinggi pemain. */
export function sideRegion(cal: Calib, side: 'near' | 'far') {
  const { spec, toImage } = calibMaps(cal);
  const y0 = side === 'far' ? -2.5 : spec.L / 2 - 0.3;
  const y1 = side === 'far' ? spec.L / 2 + 0.3 : spec.L + 2.5;
  const pts = [
    { x: -1.5, y: y0 },
    { x: spec.W + 1.5, y: y0 },
    { x: spec.W + 1.5, y: y1 },
    { x: -1.5, y: y1 },
  ].map(toImage);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let yA = Math.min(...ys);
  const yB = Math.max(...ys);
  // Tinggi badan pemain (~1.8 m) di gambar ≈ 0.9× lebar lapangan setempat; ambil ke atas.
  const widthAtTop = Math.abs(pts[1].x - pts[0].x);
  yA -= Math.max(0.12, widthAtTop * 0.75);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  x0 = clamp(x0);
  x1 = clamp(x1);
  return { x: x0, y: clamp(yA), w: Math.max(0.05, x1 - x0), h: Math.max(0.05, clamp(yB) - clamp(yA)) };
}

/* ---------------- observasi per frame ---------------- */

export interface PoseObs {
  /** Titik kaki (tengah pergelangan kaki/tumit), gambar ternormalisasi. */
  foot: Pt;
  box: { x: number; y: number; w: number; h: number };
  wristL: Pt;
  wristR: Pt;
  shoulderL: Pt;
  shoulderR: Pt;
  nose: Pt;
  score: number;
}

export interface Blob {
  x: number;
  y: number;
  area: number;
}

export interface FrameObs {
  t: number;
  poses: PoseObs[];
  blobs: Blob[];
}

export interface PlayerFrame {
  court: Pt;
  foot: Pt;
  box: PoseObs['box'];
  wristL: Pt;
  wristR: Pt;
  shoulderY: number;
  noseY: number;
  /** true = hasil interpolasi (tidak terdeteksi langsung). */
  interp?: boolean;
}

export interface Track {
  frames: (PlayerFrame | null)[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pelacakan pemain: tiap sisi (dekat/jauh) diisi `teamSize` slot. Slot 0..teamSize-1 = sisi dekat
 * kamera, sisanya sisi jauh. Penugasan per frame meminimalkan jarak total ke posisi sebelumnya.
 */
export function trackPlayers(frames: FrameObs[], cal: Calib, teamSize: 1 | 2): Track[] {
  const { spec, toCourt } = calibMaps(cal);
  const n = teamSize * 2;
  const tracks: Track[] = Array.from({ length: n }, () => ({ frames: [] }));
  const last: (Pt | null)[] = Array(n).fill(null);
  const lastSeen: number[] = Array(n).fill(-999);
  const half = spec.L / 2;

  frames.forEach((f, fi) => {
    const cands = f.poses
      .map((p) => ({ p, c: toCourt(p.foot) }))
      .filter(({ c }) => c.x > -2 && c.x < spec.W + 2 && c.y > -3.5 && c.y < spec.L + 3.5 && Number.isFinite(c.x));
    for (const side of ['near', 'far'] as const) {
      const slots = side === 'near' ? [...Array(teamSize).keys()] : [...Array(teamSize).keys()].map((i) => i + teamSize);
      let mine = cands
        .filter(({ c }) => (side === 'near' ? c.y >= half - 0.4 : c.y <= half + 0.4))
        .sort((a, b) => b.p.score - a.p.score);
      // Buang duplikat (pose ganda untuk orang yang sama).
      mine = mine.filter((x, i) => mine.findIndex((y) => dist(y.c, x.c) < 0.5) === i).slice(0, teamSize);
      let best: number[] = [];
      let bestCost = Infinity;
      const perms = teamSize === 1 ? [[0]] : [
        [0, 1],
        [1, 0],
      ];
      for (const perm of perms) {
        let cost = 0;
        perm.forEach((ci, si) => {
          const c = mine[ci];
          const prev = last[slots[si]];
          if (!c) return;
          if (prev && fi - lastSeen[slots[si]] < 45) cost += dist(prev, c.c);
          // Belum ada riwayat: pemain kiri → slot kiri (indeks kecil).
          else cost += si === 0 ? c.c.x * 0.01 : (spec.W - c.c.x) * 0.01;
        });
        if (cost < bestCost) {
          bestCost = cost;
          best = perm;
        }
      }
      slots.forEach((slot, si) => {
        const c = mine[best[si]];
        if (!c) {
          tracks[slot].frames.push(null);
          return;
        }
        const prev = last[slot];
        // Lompatan mustahil (> 9 m/s) → kemungkinan salah orang, abaikan frame ini.
        const dt = Math.max(1, fi - lastSeen[slot]) * frameDt(frames);
        if (prev && fi - lastSeen[slot] < 10 && dist(prev, c.c) / dt > 9) {
          tracks[slot].frames.push(null);
          return;
        }
        last[slot] = c.c;
        lastSeen[slot] = fi;
        tracks[slot].frames.push({
          court: c.c,
          foot: c.p.foot,
          box: c.p.box,
          wristL: c.p.wristL,
          wristR: c.p.wristR,
          shoulderY: (c.p.shoulderL.y + c.p.shoulderR.y) / 2,
          noseY: c.p.nose.y,
        });
      });
    }
  });
  for (const t of tracks) fillGaps(t, 12);
  return tracks;
}

export const frameDt = (frames: { t: number }[]) => (frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1 / 15);

/** Isi celah pendek dengan interpolasi linier; celah panjang dibiarkan kosong. */
function fillGaps(t: Track, maxGap: number) {
  const f = t.frames;
  let i = 0;
  while (i < f.length) {
    if (f[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < f.length && !f[j]) j++;
    const a = f[i - 1];
    const b = f[j];
    if (a && b && j - i <= maxGap) {
      for (let k = i; k < j; k++) {
        const r = (k - i + 1) / (j - i + 1);
        const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * r, y: p.y + (q.y - p.y) * r });
        f[k] = {
          court: lerp(a.court, b.court),
          foot: lerp(a.foot, b.foot),
          box: { x: a.box.x + (b.box.x - a.box.x) * r, y: a.box.y + (b.box.y - a.box.y) * r, w: a.box.w, h: a.box.h },
          wristL: lerp(a.wristL, b.wristL),
          wristR: lerp(a.wristR, b.wristR),
          shoulderY: a.shoulderY + (b.shoulderY - a.shoulderY) * r,
          noseY: a.noseY + (b.noseY - a.noseY) * r,
          interp: true,
        };
      }
    }
    i = j;
  }
}

/** Posisi lapangan yang dihaluskan (rata-rata bergerak) — dasar jarak tempuh & zona. */
export function smoothCourt(t: Track, win = 2): (Pt | null)[] {
  return t.frames.map((f, i) => {
    if (!f) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = i - win; k <= i + win; k++) {
      const g = t.frames[k];
      if (g) {
        sx += g.court.x;
        sy += g.court.y;
        n++;
      }
    }
    return { x: sx / n, y: sy / n };
  });
}

/* ---------------- pelacakan kok / bola ---------------- */

/**
 * Pelacak kok dari kandidat gerakan (blob) per frame. Memilih blob yang paling cocok dengan
 * prediksi lintasan (posisi + kecepatan); blob di dalam badan pemain diabaikan.
 * Hasil: posisi per frame (null = tidak terlihat).
 */
export function trackShuttle(frames: FrameObs[], tracks: Track[], aspect: number): (Pt | null)[] {
  const out: (Pt | null)[] = [];
  let p: Pt | null = null;
  let v: Pt = { x: 0, y: 0 };
  let miss = 0;
  // Skala jarak: sumbu x dikali rasio aspek supaya jarak gambar isotropik.
  const d = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const inBody = (b: Blob, fi: number) =>
    tracks.some((t) => {
      const f = t.frames[fi];
      if (!f) return false;
      const { x, y, w, h } = f.box;
      // Badan inti (tanpa lengan/raket): 60% lebar tengah, dari bahu ke kaki.
      return b.x > x + w * 0.2 && b.x < x + w * 0.8 && b.y > f.shoulderY && b.y < y + h;
    });
  const cands = frames.map((f, fi) => f.blobs.filter((b) => !inBody(b, fi)));

  for (let fi = 0; fi < frames.length; fi++) {
    const cs = cands[fi];
    if (p) {
      const pred: Pt = { x: p.x + v.x, y: p.y + v.y };
      const gate = 0.06 + Math.hypot(v.x * aspect, v.y) * 0.8;
      let best: Blob | null = null;
      let bd = Infinity;
      for (const c of cs) {
        const dd = d(c, pred);
        if (dd < gate && dd < bd) {
          bd = dd;
          best = c;
        }
      }
      if (best) {
        const nv = { x: best.x - p.x, y: best.y - p.y };
        v = { x: v.x * 0.3 + nv.x * 0.7, y: v.y * 0.3 + nv.y * 0.7 };
        p = { x: best.x, y: best.y };
        miss = 0;
        out.push(p);
        continue;
      }
      miss++;
      if (miss <= 3) {
        p = pred;
        out.push(null);
        continue;
      }
      p = null;
    }
    // Mulai lintasan baru: blob yang punya pasangan dekat di frame berikutnya (benda bergerak konsisten).
    const next = cands[fi + 1] ?? [];
    let start: Blob | null = null;
    let sv: Pt = { x: 0, y: 0 };
    let sd = Infinity;
    for (const c of cs) {
      for (const n of next) {
        const dd = d(c, n);
        if (dd > 0.008 && dd < 0.18 && dd + c.area * 0.0005 < sd) {
          sd = dd;
          start = c;
          sv = { x: n.x - c.x, y: n.y - c.y };
        }
      }
    }
    if (start) {
      p = { x: start.x, y: start.y };
      v = sv;
      miss = 0;
      out.push(p);
    } else out.push(null);
  }
  return out;
}

/* ---------------- deteksi & klasifikasi pukulan ---------------- */

export type ShotType =
  | 'servis'
  | 'smash'
  | 'clear'
  | 'drop'
  | 'lob'
  | 'netting'
  | 'drive'
  | 'bandeja'
  | 'volley'
  | 'dasar';

export const SHOT_TYPES: Record<Sport, { id: ShotType; label: string }[]> = {
  badminton: [
    { id: 'servis', label: 'Servis' },
    { id: 'smash', label: 'Smash' },
    { id: 'clear', label: 'Clear (lambung jauh)' },
    { id: 'drop', label: 'Drop shot' },
    { id: 'lob', label: 'Lob (angkat bola)' },
    { id: 'netting', label: 'Netting' },
    { id: 'drive', label: 'Drive' },
  ],
  padel: [
    { id: 'servis', label: 'Servis' },
    { id: 'smash', label: 'Smash' },
    { id: 'bandeja', label: 'Bandeja' },
    { id: 'volley', label: 'Volley' },
    { id: 'lob', label: 'Lob' },
    { id: 'dasar', label: 'Pukulan dasar' },
  ],
};

export const shotLabel = (sport: Sport, t: ShotType) => SHOT_TYPES[sport].find((x) => x.id === t)?.label.replace(/ \(.*\)$/, '') ?? t;

export interface Hit {
  id: string;
  frame: number;
  t: number;
  player: number;
  type: ShotType;
  /** true = ditemukan mesin; false = ditambahkan manual. */
  auto: boolean;
  conf?: number;
}

/** Kecepatan pergelangan tangan per frame (tinggi badan per detik). */
export function wristSpeed(t: Track, dt: number): number[] {
  return t.frames.map((f, i) => {
    const g = t.frames[i - 1];
    if (!f || !g || f.interp || g.interp) return 0;
    const bh = Math.max(0.03, f.foot.y - f.noseY);
    const s = Math.max(dist(f.wristL, g.wristL), dist(f.wristR, g.wristR));
    return s / bh / dt;
  });
}

const isNearSlot = (slot: number, teamSize: number) => slot < teamSize;

let hitSeq = 0;
export const newHitId = () => `h${Date.now().toString(36)}${(hitSeq++).toString(36)}`;

/**
 * Deteksi pukulan: gabungan (1) perubahan arah lintasan kok di dekat pemain dan
 * (2) puncak ayunan pergelangan tangan. Pukulan selalu bergantian sisi net.
 */
export function detectHits(frames: FrameObs[], tracks: Track[], shuttle: (Pt | null)[], sport: Sport, teamSize: 1 | 2): Hit[] {
  const dt = frameDt(frames);
  const speeds = tracks.map((t) => wristSpeed(t, dt));
  type Cand = { frame: number; player: number; score: number };
  const cands: Cand[] = [];

  // (1) Perubahan arah kok yang tajam di dekat tangan pemain.
  const vel = (i: number, span: number) => {
    const a = shuttle[i - span];
    const b = shuttle[i];
    return a && b ? { x: b.x - a.x, y: b.y - a.y } : null;
  };
  for (let i = 3; i < shuttle.length - 3; i++) {
    const s = shuttle[i];
    if (!s) continue;
    const before = vel(i, 2);
    const after = (() => {
      const a = shuttle[i];
      const b = shuttle[i + 2];
      return a && b ? { x: b.x - a.x, y: b.y - a.y } : null;
    })();
    if (!before || !after) continue;
    const mb = Math.hypot(before.x, before.y);
    const ma = Math.hypot(after.x, after.y);
    if (mb < 0.01 || ma < 0.01) continue;
    const cos = (before.x * after.x + before.y * after.y) / (mb * ma);
    // Hanya belokan tajam (kok berbalik arah). Puncak lengkungan (naik → turun) berbelok landai, jadi tidak terhitung.
    if (cos > 0.1) continue;
    // Pemukul: pemain dengan tangan terdekat ke kok di frame ini.
    let best = -1;
    let bd = Infinity;
    tracks.forEach((t, pi) => {
      const f = t.frames[i];
      if (!f) return;
      // Jangkauan lengan + raket ≈ 0.45× tinggi badan di gambar.
      const reach = Math.max(f.box.h * 0.45, 0.025);
      const dd = Math.min(dist(f.wristL, s), dist(f.wristR, s)) / reach;
      if (dd < 1 && dd < bd) {
        bd = dd;
        best = pi;
      }
    });
    if (best < 0) {
      // Padel: bola memantul di lantai & dinding kaca → belokan tanpa tangan di dekatnya bukan pukulan.
      if (sport === 'padel') continue;
      // Tidak ada tangan di dekat kok: tentukan sisi dari arah datang kok (turun di gambar = menuju sisi dekat).
      const side = before.y > 0 ? 'near' : 'far';
      let bs = 0;
      tracks.forEach((_, pi) => {
        if ((side === 'near') !== isNearSlot(pi, teamSize)) return;
        const s2 = Math.max(...[-2, -1, 0, 1, 2].map((k) => speeds[pi][i + k] ?? 0));
        if (s2 > bs) {
          bs = s2;
          best = pi;
        }
      });
      if (best < 0 || bs < 1.2) continue;
      cands.push({ frame: i, player: best, score: 0.6 + Math.min(0.3, bs / 10) });
    } else cands.push({ frame: i, player: best, score: 0.95 - bd * 0.25 });
  }

  // (2) Puncak ayunan pergelangan tangan (berguna saat kok tidak terlihat).
  speeds.forEach((sp, pi) => {
    for (let i = 2; i < sp.length - 2; i++) {
      const v = sp[i];
      if (v < 2.6) continue;
      if (v < sp[i - 1] || v < sp[i + 1] || v < sp[i - 2] || v < sp[i + 2]) continue;
      const f = tracks[pi].frames[i];
      if (!f) continue;
      cands.push({ frame: i, player: pi, score: Math.min(0.75, 0.35 + v / 12) });
    }
  });

  cands.sort((a, b) => a.frame - b.frame);
  // Gabungkan kandidat berdekatan (< 0.35 s) → ambil skor tertinggi.
  const minGap = Math.max(1, Math.round(0.35 / dt));
  const merged: Cand[] = [];
  for (const c of cands) {
    const prev = merged[merged.length - 1];
    if (prev && c.frame - prev.frame < minGap) {
      if (c.score > prev.score) merged[merged.length - 1] = c;
    } else merged.push(c);
  }
  // Wajib bergantian sisi net dalam satu reli; buang yang lebih lemah bila dua berturut di sisi sama.
  const rallyGap = Math.round(RALLY_GAP[sport] / dt);
  const alt: Cand[] = [];
  for (const c of merged) {
    const prev = alt[alt.length - 1];
    if (prev && c.frame - prev.frame < rallyGap && isNearSlot(prev.player, teamSize) === isNearSlot(c.player, teamSize)) {
      if (c.score > prev.score) alt[alt.length - 1] = c;
      continue;
    }
    alt.push(c);
  }
  // Pukulan tunggal yang lemah (tanpa kok, tanpa lawan membalas) kemungkinan besar bukan pukulan.
  const final = alt.filter((c, i) => {
    if (c.score >= 0.6) return true;
    const p = alt[i - 1];
    const n = alt[i + 1];
    return (p && c.frame - p.frame < rallyGap) || (n && n.frame - c.frame < rallyGap);
  });

  const hits: Hit[] = final.map((c) => ({
    id: newHitId(),
    frame: c.frame,
    t: frames[c.frame].t,
    player: c.player,
    type: 'drive',
    auto: true,
    conf: Math.round(c.score * 100) / 100,
  }));
  classifyAll(hits, frames, tracks, shuttle, sport, teamSize);
  return hits;
}

/** Klasifikasi ulang semua pukulan (dipanggil juga setelah koreksi manual). */
export function classifyAll(hits: Hit[], frames: { t: number }[], tracks: Track[], shuttle: (Pt | null)[], sport: Sport, teamSize: 1 | 2, keep?: Set<string>) {
  const spec = COURTS[sport];
  hits.sort((a, b) => a.frame - b.frame);
  hits.forEach((h, i) => {
    if (keep?.has(h.id)) return;
    const prev = hits[i - 1];
    const next = hits[i + 1];
    const first = !prev || h.t - prev.t > RALLY_GAP[sport];
    if (first) {
      h.type = 'servis';
      return;
    }
    const f = nearestFrame(tracks[h.player], h.frame);
    const flight = next && next.t - h.t < RALLY_GAP[sport] ? next.t - h.t : 1.4;
    const overhead = f ? Math.min(f.wristL.y, f.wristR.y) < f.noseY : false;
    const depth = f ? (isNearSlot(h.player, teamSize) ? f.court.y - spec.L / 2 : spec.L / 2 - f.court.y) : spec.L / 4;
    const front = depth < (spec.L / 2) * 0.33;
    const back = depth > (spec.L / 2) * 0.62;
    // Kok naik tinggi setelah dipukul? (bergerak ke atas di gambar pada 3–6 frame berikut)
    const s0 = shuttle[h.frame];
    const s1 = shuttle[Math.min(shuttle.length - 1, h.frame + 4)];
    const rising = s0 && s1 ? s0.y - s1.y > 0.04 : flight > 1.1;
    if (sport === 'badminton') {
      if (overhead) h.type = flight < 0.75 ? 'smash' : back && flight > 1.05 ? 'clear' : 'drop';
      else if (front) h.type = rising || flight > 1.0 ? 'lob' : 'netting';
      else h.type = rising && flight > 1.1 ? 'lob' : 'drive';
    } else {
      if (overhead) h.type = flight < 0.8 ? 'smash' : 'bandeja';
      else if (front) h.type = 'volley';
      else h.type = rising && flight > 1.2 ? 'lob' : 'dasar';
    }
  });
}

function nearestFrame(t: Track | undefined, i: number): PlayerFrame | null {
  if (!t) return null;
  for (let k = 0; k < 6; k++) {
    const f = t.frames[i - k] ?? t.frames[i + k];
    if (f) return f;
  }
  return null;
}

/** Pemain terdekat ke titik gambar pada frame tertentu (untuk tambah pukulan manual). */
export function nearestPlayer(tracks: Track[], frame: number, p?: Pt | null): number {
  let best = 0;
  let bd = Infinity;
  tracks.forEach((t, i) => {
    const f = nearestFrame(t, frame);
    if (!f) return;
    const dd = p ? Math.min(dist(f.wristL, p), dist(f.wristR, p)) : -wristSpeedAt(t, frame);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  return best;
}

function wristSpeedAt(t: Track, i: number) {
  const f = t.frames[i];
  const g = t.frames[i - 1];
  if (!f || !g) return 0;
  return Math.max(dist(f.wristL, g.wristL), dist(f.wristR, g.wristR));
}

/* ---------------- statistik ---------------- */

export interface PlayerStats {
  hits: number;
  byType: Partial<Record<ShotType, number>>;
  distance: number; // meter
  kcal: number;
  zones: { depan: number; tengah: number; belakang: number }; // persen
  maxSpeed: number; // m/s
  coverage: number; // persen frame terdeteksi
}

export interface Summary {
  duration: number;
  rallies: number;
  longestRally: number;
  players: PlayerStats[];
}

/** Kalori perkiraan: MET 4 + intensitas dari kecepatan rata-rata (maks MET 9). */
export function kcalFor(weightKg: number, seconds: number, meters: number) {
  if (seconds <= 0) return 0;
  const avg = meters / seconds;
  const met = Math.min(9, 4 + avg * 2.5);
  return weightKg * met * (seconds / 3600);
}

/** Statistik kumulatif sampai frame `upTo` (untuk penghitung langsung di video ekspor). */
export function summarize(frames: { t: number }[], tracks: Track[], hits: Hit[], sport: Sport, teamSize: 1 | 2, weights: number[], upTo = Infinity): Summary {
  const spec = COURTS[sport];
  const dt = frameDt(frames);
  const end = Math.min(frames.length - 1, upTo);
  const seconds = frames.length ? frames[end].t - frames[0].t : 0;
  const players = tracks.map((t, pi): PlayerStats => {
    const sm = smoothCourt(t);
    let d = 0;
    let maxSpeed = 0;
    const zones = { depan: 0, tengah: 0, belakang: 0 };
    let seen = 0;
    let prev: Pt | null = null;
    for (let i = 0; i <= end; i++) {
      const p = sm[i];
      if (!p) {
        prev = null;
        continue;
      }
      seen++;
      if (prev) {
        const step = dist(p, prev);
        const sp = step / dt;
        if (step > 0.015 && sp < 8) {
          d += step;
          maxSpeed = Math.max(maxSpeed, sp);
        }
      }
      prev = p;
      const depth = isNearSlot(pi, teamSize) ? p.y - spec.L / 2 : spec.L / 2 - p.y;
      const r = depth / (spec.L / 2);
      if (r < 0.33) zones.depan++;
      else if (r < 0.66) zones.tengah++;
      else zones.belakang++;
    }
    const tot = Math.max(1, zones.depan + zones.tengah + zones.belakang);
    const mine = hits.filter((h) => h.player === pi && h.frame <= end);
    const byType: PlayerStats['byType'] = {};
    for (const h of mine) byType[h.type] = (byType[h.type] ?? 0) + 1;
    return {
      hits: mine.length,
      byType,
      distance: d,
      // Kalori hanya untuk waktu pemain benar-benar terlacak (bukan saat keluar frame / tidak terdeteksi).
      kcal: kcalFor(weights[pi] ?? 65, seconds * (seen / Math.max(1, end + 1)), d),
      zones: { depan: (zones.depan / tot) * 100, tengah: (zones.tengah / tot) * 100, belakang: (zones.belakang / tot) * 100 },
      maxSpeed,
      coverage: (seen / Math.max(1, end + 1)) * 100,
    };
  });
  const sorted = hits.filter((h) => h.frame <= end).sort((a, b) => a.t - b.t);
  let rallies = 0;
  let longest = 0;
  let cur = 0;
  sorted.forEach((h, i) => {
    if (i === 0 || h.t - sorted[i - 1].t > RALLY_GAP[sport]) {
      rallies++;
      cur = 0;
    }
    cur++;
    longest = Math.max(longest, cur);
  });
  return { duration: seconds, rallies, longestRally: longest, players };
}

/** Tukar data dua slot pemain (koreksi identitas kiri/kanan). */
export function swapSlots(tracks: Track[], hits: Hit[], a: number, b: number) {
  [tracks[a], tracks[b]] = [tracks[b], tracks[a]];
  for (const h of hits) h.player = h.player === a ? b : h.player === b ? a : h.player;
}
