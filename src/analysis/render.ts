/** Gambar overlay analisis (nama pemain, jejak kok, label pukulan, peta mini) dan ekspor video. */
import { calibMaps, courtLines, COURTS, frameDt, shotLabel, smoothCourt, summarize, type Anchor, type Calib, type FrameObs, type Hit, type Pt, type Sport, type Track } from './core.ts';

export const PLAYER_COLORS = ['#C6FF3D', '#2BC58A', '#38BDF8', '#FB923C'];
const INK = '#0E1714';
const LIME = '#C6FF3D';

/** Peringkat dari sesi milik pengguna, ditampilkan di overlay video. */
export interface Ranking {
  session: string;
  sortBy: 'wins' | 'points';
  rows: { rank: number; name: string; played: number; won: number; lost: number; total: number; inMatch: boolean }[];
}

/** Pengaturan tampilan video hasil. */
export interface ExportStyle {
  /** Animasi jejak kok/bola. */
  shuttle: boolean;
  /** Label jenis pukulan: di panel atas (di bawah Pukulan | Reli) atau di dalam video di atas pemain. */
  shotPos: 'panel' | 'video';
}

/** Waktu (detik) frame ekspor yang sedang digambar — untuk animasi halus 30 fps. */
let exportTime: number | null = null;

export interface Result {
  sport: Sport;
  teamSize: 1 | 2;
  cal: Calib;
  start: number;
  frames: { t: number }[];
  tracks: Track[];
  shuttle: (Pt | null)[];
  hits: Hit[];
  names: string[];
  weights: number[];
  title: string;
  /** Observasi mentah per frame (untuk lacak ulang setelah koreksi posisi). */
  obs?: FrameObs[];
  /** Titik kunci posisi pemain (manual). */
  anchors?: Anchor[];
  /** Gaya video ekspor. */
  style?: ExportStyle;
  /** Peringkat 5 besar (opsional, null = tidak ditampilkan). */
  ranking?: Ranking | null;
}

export const frameAt = (r: Result, t: number) => {
  if (!r.frames.length) return 0;
  const dt = frameDt(r.frames);
  return Math.max(0, Math.min(r.frames.length - 1, Math.round((t - r.frames[0].t) / dt)));
};

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, size: number) {
  ctx.font = `700 ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + size * 1.1;
  const h = size * 1.6;
  const r = h / 2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + r, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Penanda pemain modern di lantai: sorotan bercahaya, cincin inti, dua busur yang berputar pelan,
 * denyut keluar berkala, dan kilatan lime saat pemain memukul.
 */
function playerMarker(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, t: number, flash: number, u: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  // Sorotan (glow) di lantai.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.15);
  g.addColorStop(0, rgba(color, 0.5));
  g.addColorStop(0.55, rgba(color, 0.2));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx * 1.15, 0, Math.PI * 2);
  ctx.fill();
  // Denyut keluar.
  const ph = (t % 1.6) / 1.6;
  ctx.strokeStyle = rgba(color, 0.55 * (1 - ph));
  ctx.lineWidth = u / 6;
  ctx.beginPath();
  ctx.arc(0, 0, rx * (0.75 + 0.55 * ph), 0, Math.PI * 2);
  ctx.stroke();
  // Cincin inti + garis tepi putih tipis.
  ctx.strokeStyle = color;
  ctx.lineWidth = u / 3.2;
  ctx.beginPath();
  ctx.arc(0, 0, rx * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = u / 12;
  ctx.beginPath();
  ctx.arc(0, 0, rx * 0.72 - u / 6, 0, Math.PI * 2);
  ctx.stroke();
  // Dua busur berputar.
  const rot = t * 1.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = u / 5;
  ctx.lineCap = 'round';
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(0, 0, rx, rot + off, rot + off + Math.PI * 0.55);
    ctx.stroke();
  }
  // Kilatan saat memukul.
  if (flash > 0) {
    ctx.strokeStyle = rgba('#C6FF3D', flash);
    ctx.lineWidth = u / 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, rx * (1.05 + 0.45 * (1 - flash)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Label nama: pil gelap dengan titik warna pemain dan penunjuk kecil ke kepala. */
function nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, size: number) {
  ctx.save();
  ctx.font = `700 ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const dot = size * 0.42;
  const w = ctx.measureText(text).width + size * 1.3 + dot * 2;
  const h = size * 1.7;
  const left = x - w / 2;
  const top = y - h;
  ctx.fillStyle = 'rgba(14,23,20,0.82)';
  ctx.beginPath();
  ctx.moveTo(left + h / 2, top);
  ctx.arcTo(left + w, top, left + w, top + h, h / 2);
  ctx.arcTo(left + w, top + h, left, top + h, h / 2);
  ctx.arcTo(left, top + h, left, top, h / 2);
  ctx.arcTo(left, top, left + w, top, h / 2);
  ctx.closePath();
  ctx.fill();
  // penunjuk
  ctx.beginPath();
  ctx.moveTo(x - size * 0.35, top + h - 0.5);
  ctx.lineTo(x + size * 0.35, top + h - 0.5);
  ctx.lineTo(x, top + h + size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = Math.max(1, size / 10);
  ctx.beginPath();
  ctx.moveTo(left + h / 2, top);
  ctx.arcTo(left + w, top, left + w, top + h, h / 2);
  ctx.arcTo(left + w, top + h, left, top + h, h / 2);
  ctx.arcTo(left, top + h, left, top, h / 2);
  ctx.arcTo(left, top, left + w, top, h / 2);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(left + size * 0.65 + dot / 2, top + h / 2, dot / 2 + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + size * 0.65 + dot + size * 0.35, top + h / 2 + 0.5);
  ctx.restore();
}

/** Label pukulan terakhir di panel (di luar video): "SMASH · Nama", menyala saat pukulan baru. */
export function drawShotBanner(ctx: CanvasRenderingContext2D, r: Result, now: number, cx: number, cy: number, size: number) {
  const last = r.hits.filter((h) => h.t <= now + 0.001).slice(-1)[0];
  if (!last) return;
  const age = now - last.t;
  const glow = Math.max(0, 1 - age / 0.8);
  const label = shotLabel(r.sport, last.type).toUpperCase();
  const name = r.names[last.player] ?? `Pemain ${last.player + 1}`;
  const color = PLAYER_COLORS[last.player % 4];
  ctx.save();
  ctx.font = `800 ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const lw = ctx.measureText(label).width;
  ctx.font = `700 ${size * 0.62}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const nw = ctx.measureText(name).width;
  const pad = size * 0.7;
  const gap = size * 0.6;
  const w = pad * 2 + lw + gap + size * 0.5 + nw;
  const h = size * 1.75;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = glow > 0 ? `rgba(198,255,61,${0.92 * glow + 0.0})` : 'rgba(14,23,20,0.78)';
  if (glow <= 0) ctx.fillStyle = 'rgba(14,23,20,0.78)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = glow > 0 ? 'rgba(14,23,20,0.25)' : 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const on = glow > 0.15;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  ctx.fillStyle = on ? INK : LIME;
  ctx.fillText(label, x + pad, cy + 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + pad + lw + gap + size * 0.2, cy, size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.font = `700 ${size * 0.62}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  ctx.fillStyle = on ? INK : '#ffffff';
  ctx.fillText(name, x + pad + lw + gap + size * 0.5, cy + 1);
  ctx.restore();
}

export interface OverlayOpts {
  court?: boolean;
  boxes?: boolean;
  selectedHit?: string | null;
  /** Waktu tepat (detik) yang digambar; posisi diinterpolasi di antara frame analisis. */
  time?: number;
}

/** Posisi tampilan pemain per frame analisis, sudah dihaluskan (tanpa getar deteksi pose). */
interface SmoothFrame {
  fx: number;
  fy: number;
  hx: number;
  hy: number;
  bw: number;
  bx: number;
  by: number;
  bh: number;
}
const smoothCache = new WeakMap<Track, (SmoothFrame | null)[]>();
const WEIGHTS = [1, 2, 3, 4, 3, 2, 1]; // jendela ±3 frame, berbobot ke tengah

function smoothTrack(t: Track): (SmoothFrame | null)[] {
  const hit = smoothCache.get(t);
  if (hit) return hit;
  const out = t.frames.map((f, i) => {
    if (!f) return null;
    const acc = { fx: 0, fy: 0, hx: 0, hy: 0, bw: 0, bx: 0, by: 0, bh: 0 };
    let wsum = 0;
    for (let k = -3; k <= 3; k++) {
      const g = t.frames[i + k];
      if (!g) continue;
      const wt = WEIGHTS[k + 3];
      wsum += wt;
      acc.fx += g.foot.x * wt;
      acc.fy += g.foot.y * wt;
      acc.hx += (g.box.x + g.box.w / 2) * wt;
      acc.hy += g.box.y * wt;
      acc.bw += g.box.w * wt;
      acc.bx += g.box.x * wt;
      acc.by += g.box.y * wt;
      acc.bh += g.box.h * wt;
    }
    for (const key of Object.keys(acc) as (keyof SmoothFrame)[]) acc[key] /= wsum;
    return acc;
  });
  smoothCache.set(t, out);
  return out;
}

/** Interpolasi posisi halus di frame pecahan `ff` (mis. 12.5 = di antara frame 12 dan 13). */
function smoothAt(t: Track, ff: number): SmoothFrame | null {
  const s = smoothTrack(t);
  const i = Math.floor(ff);
  const a = s[i];
  const b = s[i + 1];
  const r = ff - i;
  if (a && b) {
    const out = {} as SmoothFrame;
    for (const key of Object.keys(a) as (keyof SmoothFrame)[]) out[key] = a[key] + (b[key] - a[key]) * r;
    return out;
  }
  return a ?? (r > 0.5 ? b : null) ?? null;
}

/** Overlay di atas video. (ox, oy, w, h) = area video di kanvas. */
export function drawOverlay(ctx: CanvasRenderingContext2D, r: Result, fi: number, ox: number, oy: number, w: number, h: number, o: OverlayOpts = {}) {
  const P = (p: Pt) => ({ x: ox + p.x * w, y: oy + p.y * h });
  const u = Math.max(10, w / 70);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (o.court) {
    const { spec, toImage } = calibMaps(r.cal);
    ctx.strokeStyle = 'rgba(198,255,61,0.55)';
    ctx.lineWidth = Math.max(1.5, u / 6);
    for (const [a, b] of courtLines(spec)) {
      const A = P(toImage(a));
      const B = P(toImage(b));
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  }

  const now = o.time ?? exportTime ?? r.frames[fi]?.t ?? 0;
  const t0 = r.frames[0]?.t ?? 0;
  const dt = frameDt(r.frames);
  const ff = Math.max(0, Math.min(r.frames.length - 1, (now - t0) / dt));
  const f0 = Math.floor(ff);
  const frac = ff - f0;

  // Jejak kok/bola: garis meruncing dari posisi lama ke ujung yang bergerak halus.
  if (r.style?.shuttle !== false) {
    const pts: Pt[] = [];
    for (let k = 7; k >= 0; k--) {
      const s = r.shuttle[f0 - k];
      if (s) pts.push(s);
      else if (pts.length) pts.length = 0; // hanya bagian lintasan yang tersambung
    }
    const nextS = r.shuttle[f0 + 1];
    const cur = r.shuttle[f0];
    if (cur && nextS) pts.push({ x: cur.x + (nextS.x - cur.x) * frac, y: cur.y + (nextS.y - cur.y) * frac });
    if (pts.length >= 2) {
      for (let k = 1; k < pts.length; k++) {
        const q = k / (pts.length - 1);
        const A = P(pts[k - 1]);
        const B = P(pts[k]);
        ctx.strokeStyle = `rgba(198,255,61,${0.12 + 0.6 * q})`;
        ctx.lineWidth = u * (0.12 + 0.38 * q);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
    }
    if (pts.length) {
      const head = P(pts[pts.length - 1]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = LIME;
      ctx.lineWidth = u / 5;
      ctx.beginPath();
      ctx.arc(head.x, head.y, u * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Pemain: penanda modern di kaki + label nama di atas kepala (posisi halus & terinterpolasi).
  const heads: (Pt | null)[] = [];
  r.tracks.forEach((t, i) => {
    const s = smoothAt(t, ff);
    heads[i] = null;
    if (!s) return;
    const c = PLAYER_COLORS[i % 4];
    const foot = P({ x: s.fx, y: s.fy });
    const lastHit = r.hits.filter((x) => x.player === i && x.t <= now + 0.001).slice(-1)[0];
    const flash = lastHit ? Math.max(0, 1 - (now - lastHit.t) / 0.5) : 0;
    const rx = Math.max(u * 1.1, s.bw * w * 0.62);
    playerMarker(ctx, foot.x, foot.y, rx, Math.max(u * 0.4, rx * 0.34), c, now + i * 0.4, flash, u);
    if (o.boxes) {
      ctx.strokeStyle = c + '99';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + s.bx * w, oy + s.by * h, s.bw * w, s.bh * h);
    }
    const head = P({ x: s.hx, y: s.hy });
    heads[i] = head;
    nameTag(ctx, head.x, head.y - u * 0.7, r.names[i] ?? `Pemain ${i + 1}`, c, u * 0.9);
  });

  // Label pukulan di atas pemain selama 0.9 detik (bila tidak dipindah ke panel), ikut gerak pemain.
  const recent = r.style?.shotPos === 'panel' ? undefined : r.hits.filter((x) => now - x.t >= 0 && now - x.t < 0.9).slice(-1)[0];
  const sel = o.selectedHit ? r.hits.find((x) => x.id === o.selectedHit) : null;
  for (const hit of [recent, sel].filter(Boolean) as Hit[]) {
    let p = heads[hit.player];
    if (!p) {
      const f = r.tracks[hit.player]?.frames[hit.frame];
      if (!f) continue;
      p = P({ x: f.box.x + f.box.w / 2, y: f.box.y });
    }
    const age = now - hit.t;
    const a = hit === sel ? 1 : age < 0.7 ? 1 : Math.max(0, 1 - (age - 0.7) / 0.2);
    const rise = hit === sel ? 0 : Math.min(1, age / 0.18); // muncul naik sedikit, halus
    ctx.globalAlpha = a;
    pill(ctx, p.x, p.y - u * (2.9 + 0.5 * rise), shotLabel(r.sport, hit.type).toUpperCase(), LIME, INK, u * 1.15);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Peta lapangan mini (tampak atas) dengan posisi & jejak pemain. */
export function drawMiniCourt(ctx: CanvasRenderingContext2D, r: Result, fi: number, x: number, y: number, w: number, h: number, horizontal = false) {
  if (horizontal) {
    // Diputar 90°: baseline jauh di kiri, dekat kamera di kanan.
    ctx.save();
    ctx.translate(x, y + h);
    ctx.rotate(-Math.PI / 2);
    drawMiniCourt(ctx, r, fi, 0, 0, h, w);
    ctx.restore();
    return;
  }
  const spec = COURTS[r.sport];
  const pad = 10;
  const s = Math.min((w - pad * 2) / spec.W, (h - pad * 2) / spec.L);
  const cw = spec.W * s;
  const ch = spec.L * s;
  const cx = x + (w - cw) / 2;
  const cy = y + (h - ch) / 2;
  ctx.save();
  ctx.fillStyle = r.sport === 'badminton' ? '#1F7A57' : '#2563EB';
  roundRect(ctx, cx - 6, cy - 6, cw + 12, ch + 12, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  for (const [a, b] of courtLines(spec)) {
    ctx.beginPath();
    ctx.moveTo(cx + a.x * s, cy + a.y * s);
    ctx.lineTo(cx + b.x * s, cy + b.y * s);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + ch / 2);
  ctx.lineTo(cx + cw + 6, cy + ch / 2);
  ctx.stroke();
  const dt = frameDt(r.frames);
  const trail = Math.round(2 / dt);
  r.tracks.forEach((t, i) => {
    const sm = smoothCourt(t);
    const c = PLAYER_COLORS[i % 4];
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    let started = false;
    for (let k = Math.max(0, fi - trail); k <= fi; k++) {
      const p = sm[k];
      if (!p) {
        started = false;
        continue;
      }
      const X = cx + p.x * s;
      const Y = cy + p.y * s;
      if (!started) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
      started = true;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const p = sm[fi];
    if (!p) return;
    ctx.fillStyle = c;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + p.x * s, cy + p.y * s, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Panel gelap transparan bergaris tipis (dasar semua kartu overlay). */
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 20, alpha = 0.78) {
  ctx.fillStyle = `rgba(14,23,20,${alpha})`;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

const F = (wgt: number, size: number) => `${wgt} ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;

/** Angka besar + label kecil di bawahnya, rata tengah di cx. */
function stat(ctx: CanvasRenderingContext2D, cx: number, base: number, value: string, label: string, color: string, size: number) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = F(800, size);
  ctx.fillStyle = color;
  ctx.fillText(value, cx, base);
  ctx.font = F(700, Math.round(size * 0.3));
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(label, cx, base + Math.round(size * 0.52));
}

/** 5 besar peringkat; pemain match ini disorot dan tetap tampil walau di luar 5 besar. */
function rankRows(rk: Ranking) {
  const rows = rk.rows.slice(0, 5);
  const missing = rk.rows.filter((r) => r.inMatch && !rows.includes(r)).slice(0, 2);
  if (missing.length) rows.splice(rows.length - missing.length, missing.length, ...missing);
  return rows;
}

/** Panel peringkat sesi di kotak (x, y, w, h); ukuran huruf mengikuti tinggi baris. */
export function drawRanking(ctx: CanvasRenderingContext2D, rk: Ranking, x: number, y: number, w: number, h: number) {
  const rows = rankRows(rk);
  const head = 40;
  const pad = 14;
  const rh = (h - head - 8) / rows.length;
  const fs = Math.max(13, Math.min(17, rh * 0.5));
  ctx.save();
  panel(ctx, x, y, w, h, 18);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = F(800, 13);
  ctx.fillStyle = LIME;
  ctx.fillText('PERINGKAT', x + pad, y + 24);
  const lw = ctx.measureText('PERINGKAT  ').width;
  ctx.font = F(600, 13);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(clip(ctx, rk.session, w - pad * 2 - lw - 80), x + pad + lw, y + 24);
  ctx.textAlign = 'right';
  ctx.font = F(700, 11);
  ctx.fillText(rk.sortBy === 'wins' ? 'M-K   MENANG' : 'M-K   POIN', x + w - pad, y + 24);
  rows.forEach((r, i) => {
    const ry = y + head + i * rh;
    const cy = ry + rh / 2;
    if (r.inMatch) {
      ctx.fillStyle = 'rgba(198,255,61,0.16)';
      roundRect(ctx, x + 6, ry + 1, w - 12, rh - 2, 10);
      ctx.fill();
    }
    const br = Math.min(11, rh * 0.36);
    ctx.fillStyle = r.rank <= 3 ? LIME : 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(x + pad + br, cy, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = F(800, br * 1.15);
    ctx.fillStyle = r.rank <= 3 ? INK : '#ffffff';
    ctx.fillText(String(r.rank), x + pad + br, cy + 0.5);
    ctx.textAlign = 'left';
    ctx.font = F(r.inMatch ? 800 : 600, fs);
    ctx.fillStyle = r.inMatch ? LIME : '#ffffff';
    ctx.fillText(clip(ctx, r.name, w - pad * 2 - br * 2 - 110), x + pad + br * 2 + 10, cy + 0.5);
    ctx.textAlign = 'right';
    ctx.font = F(600, fs * 0.85);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(`${r.won}-${r.lost}`, x + w - pad - 52, cy + 0.5);
    ctx.font = F(800, fs);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(rk.sortBy === 'wins' ? r.won : r.total), x + w - pad, cy + 0.5);
  });
  ctx.restore();
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

/** Merek "Wins Court": Wins putih, Court lime. */
function brand(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = F(800, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Wins ', x, y);
  ctx.fillStyle = LIME;
  ctx.fillText('Court', x + ctx.measureText('Wins ').width, y);
}

/** Label pil, tepi kanannya di `right`. */
function pillRight(ctx: CanvasRenderingContext2D, right: number, y: number, text: string, size: number) {
  ctx.font = `700 ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + size * 1.1;
  pill(ctx, right - w / 2, y, text, LIME, INK, size);
}

/** Kartu statistik pemain: nama + pukulan / meter / kkal. */
function playerCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  i: number,
  name: string,
  p: { hits: number; distance: number; kcal: number },
  showKcal: boolean,
  compact = false,
) {
  if (compact) {
    // Versi ringkas (lebar ±150 px): nama, angka pukulan besar, meter & kkal kecil.
    panel(ctx, x, y, w, h, 16);
    ctx.fillStyle = PLAYER_COLORS[i % 4];
    ctx.beginPath();
    ctx.arc(x + 16, y + 22, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = F(800, 15);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(clip(ctx, name, w - 36), x + 28, y + 27);
    ctx.font = F(800, 30);
    ctx.fillStyle = LIME;
    ctx.fillText(String(p.hits), x + 14, y + 66);
    const hw = ctx.measureText(String(p.hits)).width;
    ctx.font = F(600, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText('pukulan', x + 18 + hw, y + 66);
    ctx.font = F(700, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(clip(ctx, `${fmt1(p.distance)} m${showKcal ? ` · ${fmt1(p.kcal)} kkal` : ''}`, w - 24), x + 14, y + h - 14);
    return;
  }
  panel(ctx, x, y, w, h, 20);
  ctx.fillStyle = PLAYER_COLORS[i % 4];
  ctx.beginPath();
  ctx.arc(x + 24, y + 30, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = F(800, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(clip(ctx, name, w - 56), x + 40, y + 37);
  const stats: [string, string][] = [
    [String(p.hits), 'pukulan'],
    [fmt1(p.distance), 'meter'],
  ];
  if (showKcal) stats.push([fmt1(p.kcal), 'kkal']);
  const sw = (w - 32) / stats.length;
  stats.forEach(([v, l], k) => {
    const sx = x + 18 + k * sw;
    ctx.font = F(800, 30);
    ctx.fillStyle = k === 0 ? LIME : '#ffffff';
    ctx.fillText(v, sx, y + h - 34);
    ctx.font = F(600, 13);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText(l, sx, y + h - 14);
  });
}

/**
 * 9:16 dari video vertikal: video jadi latar penuh (tidak dibingkai, tidak digelapkan).
 * Overlay dikumpulkan di bagian atas (biasanya dinding/atap di atas lapangan jauh) dan satu baris tipis
 * di bawah, supaya lapangan & pemain tetap terlihat.
 */
function drawVerticalPortrait(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  r: Result,
  fi: number,
  st: ReturnType<typeof summarize>,
  totalHits: number,
  rk: Ranking | null,
  showKcal: boolean,
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const M = 32;
  const G = 12;
  const vw0 = video.videoWidth || 720;
  const vh0 = video.videoHeight || 1280;
  // Latar penuh: video 9:16 pas tanpa potongan (rasio lain dipusatkan, sisa minimal).
  const s = Math.max(W / vw0, H / vh0);
  const ow = vw0 * s;
  const oh = vh0 * s;
  const ox = (W - ow) / 2;
  const oy = (H - oh) / 2;
  ctx.drawImage(video, ox, oy, ow, oh);
  drawOverlay(ctx, r, fi, ox, oy, ow, oh);

  // Bayangan tipis hanya di tepi atas & bawah (di belakang teks), bukan di tengah video.
  const gt = ctx.createLinearGradient(0, 0, 0, 260);
  gt.addColorStop(0, 'rgba(14,23,20,0.7)');
  gt.addColorStop(1, 'rgba(14,23,20,0)');
  ctx.fillStyle = gt;
  ctx.fillRect(0, 0, W, 260);
  const gb = ctx.createLinearGradient(0, H - 170, 0, H);
  gb.addColorStop(0, 'rgba(14,23,20,0)');
  gb.addColorStop(1, 'rgba(14,23,20,0.7)');
  ctx.fillStyle = gb;
  ctx.fillRect(0, H - 170, W, 170);

  // Header.
  brand(ctx, M, 74, 34);
  pillRight(ctx, W - M, 62, 'AI MATCH ANALYSIS', 13);

  // Strip ringkas: PUKULAN | RELI | peta mini mendatar.
  const sy = 98;
  const sh = 80;
  const SW = W - M * 2;
  const mapW = 176;
  panel(ctx, M, sy, SW, sh, 18, 0.72);
  const statW = (SW - mapW) / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M + statW, sy + 16);
  ctx.lineTo(M + statW, sy + sh - 16);
  ctx.moveTo(M + statW * 2, sy + 16);
  ctx.lineTo(M + statW * 2, sy + sh - 16);
  ctx.stroke();
  stat(ctx, M + statW / 2, sy + 44, String(totalHits), 'PUKULAN', LIME, 36);
  stat(ctx, M + statW * 1.5, sy + 44, String(st.rallies), 'RELI', '#ffffff', 36);
  drawMiniCourt(ctx, r, fi, M + statW * 2 + 4, sy + 3, mapW - 8, sh - 6, true);
  const band = r.style?.shotPos === 'panel' ? 50 : 0;
  if (band) drawShotBanner(ctx, r, exportTime ?? r.frames[fi]?.t ?? 0, W / 2, sy + sh + G + 20, 22);

  // Peringkat (opsional) di bawah strip, separuh lebar agar tidak menutupi tengah video.
  if (rk) drawRanking(ctx, rk, M, sy + sh + G + band, 330, 172);

  // Bawah: satu baris kartu pemain tipis + footer.
  const n = st.players.length;
  const cg = 8;
  const ch = 72;
  const cw = (W - M * 2 - cg * (n - 1)) / n;
  const cy = H - 64 - ch;
  st.players.forEach((p, i) => {
    const x = M + i * (cw + cg);
    panel(ctx, x, cy, cw, ch, 14, 0.72);
    ctx.fillStyle = PLAYER_COLORS[i % 4];
    ctx.beginPath();
    ctx.arc(x + 14, cy + 20, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = F(800, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(clip(ctx, r.names[i] ?? `Pemain ${i + 1}`, cw - 34), x + 26, cy + 25);
    ctx.font = F(800, 22);
    ctx.fillStyle = LIME;
    ctx.fillText(String(p.hits), x + 12, cy + 55);
    const hw = ctx.measureText(String(p.hits)).width;
    ctx.font = F(700, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(clip(ctx, `pkl · ${fmt1(p.distance)} m${showKcal ? ` · ${fmt1(p.kcal)} kkal` : ''}`, cw - hw - 22), x + 16 + hw, cy + 54);
  });

  ctx.textAlign = 'center';
  ctx.font = F(800, 26);
  ctx.fillStyle = LIME;
  ctx.fillText('wins-court.com', W / 2, H - 30);
  ctx.font = F(600, 11);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Beta · angka perkiraan AI dari video', W / 2, H - 12);
}

/** Satu frame video ekspor (layout 9:16 atau 16:9) dengan grid & margin konsisten. */
export function drawExportFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  r: Result,
  fi: number,
  layout: 'portrait' | 'landscape',
  showKcal: boolean,
  time?: number,
) {
  exportTime = time ?? null;
  try {
    drawExportFrameInner(ctx, video, r, fi, layout, showKcal);
  } finally {
    exportTime = null;
  }
}

function drawExportFrameInner(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, r: Result, fi: number, layout: 'portrait' | 'landscape', showKcal: boolean) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const st = summarize(r.frames, r.tracks, r.hits, r.sport, r.teamSize, r.weights, fi);
  const totalHits = st.players.reduce((n, p) => n + p.hits, 0);
  const vw0 = video.videoWidth || 1280;
  const vh0 = video.videoHeight || 720;
  const va = vw0 / vh0;
  const rk = r.ranking?.rows.length ? r.ranking : null;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);

  if (layout === 'portrait') {
    if (va <= 0.8) {
      drawVerticalPortrait(ctx, video, r, fi, st, totalHits, rk, showKcal);
      return;
    }
    const M = 36;
    const G = 16;
    // Grid (atas → bawah): header | strip ringkas | VIDEO | peringkat (opsional) | kartu pemain | footer.
    // Bagian atas sengaja tipis supaya video & lapangan jadi fokus.
    const stripY = 112;
    const stripH = 92;
    const cols: number = 2;
    const rows = Math.ceil(st.players.length / cols);
    const ch = cols === 4 ? 104 : rows > 1 ? 112 : 132;
    const cardsBottom = H - 88;
    const cardsTop = cardsBottom - rows * ch - (rows - 1) * G;
    const RH = 196;
    const rankTop = rk ? cardsTop - G - RH : cardsTop;
    const shotBand = r.style?.shotPos === 'panel' ? 52 : 0;
    const zTop = stripY + stripH + G + shotBand;
    const zBot = rankTop - G;
    const zH = zBot - zTop;

    // Lapangan dari kalibrasi → pusat potongan video.
    const qx = r.cal.quad.map((p) => p.x);
    const cMin = Math.min(...qx);
    const cMax = Math.max(...qx);
    const cx = (cMin + cMax) / 2;

    // Latar penuh 9:16: video yang sama di-zoom menutupi layar lalu digelapkan,
    // supaya ruang di sekitar video utama tetap menyatu (bukan pita hitam).
    const sBg = Math.max(W / vw0, H / vh0);
    const bw = vw0 * sBg;
    const bh = vh0 * sBg;
    ctx.drawImage(video, Math.min(0, Math.max(W - bw, W / 2 - cx * bw)), (H - bh) / 2, bw, bh);
    ctx.fillStyle = 'rgba(14,23,20,0.72)';
    ctx.fillRect(0, 0, W, H);

    // Video utama TIDAK dipotong: dimuat utuh di zona tengah, tidak tertimpa kartu apa pun.
    const s = Math.min(W / vw0, zH / vh0);
    const dw = vw0 * s;
    const dh = vh0 * s;
    const dx = (W - dw) / 2;
    const dy = zTop + (zH - dh) / 2;
    const full = dw >= W - 1;
    ctx.save();
    roundRect(ctx, dx, dy, dw, dh, full ? 0 : 22);
    ctx.clip();
    ctx.drawImage(video, dx, dy, dw, dh);
    drawOverlay(ctx, r, fi, dx, dy, dw, dh);
    ctx.restore();
    if (!full) {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, dx, dy, dw, dh, 22);
      ctx.stroke();
    }

    // Gradasi tipis atas, lebih pekat di bawah (area kartu).
    const gt = ctx.createLinearGradient(0, 0, 0, zTop);
    gt.addColorStop(0, 'rgba(14,23,20,0.85)');
    gt.addColorStop(1, 'rgba(14,23,20,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, zTop);
    const gb = ctx.createLinearGradient(0, zBot, 0, H);
    gb.addColorStop(0, 'rgba(14,23,20,0)');
    gb.addColorStop(0.3, 'rgba(14,23,20,0.75)');
    gb.addColorStop(1, 'rgba(14,23,20,0.95)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, zBot, W, H - zBot);

    // Header satu baris: merek kiri, label kanan.
    brand(ctx, M, 80, 38);
    pillRight(ctx, W - M, 67, 'AI MATCH ANALYSIS', 14);

    // Strip ringkas: PUKULAN | RELI | peta mini mendatar.
    const SW = W - M * 2;
    const mapW = 196;
    panel(ctx, M, stripY, SW, stripH, 20);
    const statW = (SW - mapW) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M + statW, stripY + 18);
    ctx.lineTo(M + statW, stripY + stripH - 18);
    ctx.moveTo(M + statW * 2, stripY + 18);
    ctx.lineTo(M + statW * 2, stripY + stripH - 18);
    ctx.stroke();
    stat(ctx, M + statW / 2, stripY + 52, String(totalHits), 'PUKULAN', LIME, 42);
    stat(ctx, M + statW * 1.5, stripY + 52, String(st.rallies), 'RELI', '#ffffff', 42);
    drawMiniCourt(ctx, r, fi, M + statW * 2 + 6, stripY + 4, mapW - 12, stripH - 8, true);
    if (shotBand) drawShotBanner(ctx, r, exportTime ?? r.frames[fi]?.t ?? 0, W / 2, stripY + stripH + G + shotBand / 2 - 4, 24);

    // Peringkat (opsional) di atas kartu pemain.
    if (rk) drawRanking(ctx, rk, M, rankTop, SW, RH);

    // Kartu pemain.
    const cg = cols === 4 ? 10 : G;
    const cw = (W - M * 2 - cg * (cols - 1)) / cols;
    st.players.forEach((p, i) => {
      playerCard(ctx, M + (i % cols) * (cw + cg), cardsTop + Math.floor(i / cols) * (ch + G), cw, ch, i, r.names[i] ?? `Pemain ${i + 1}`, p, showKcal, cols === 4);
    });

    // Footer.
    ctx.textAlign = 'center';
    ctx.font = F(800, 30);
    ctx.fillStyle = LIME;
    ctx.fillText('wins-court.com', W / 2, H - 46);
    ctx.font = F(600, 13);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Beta · angka perkiraan AI dari video', W / 2, H - 22);
  } else {
    const M = 28;
    const G = 14;
    let vw = W;
    let vh = W / va;
    if (vh > H) {
      vh = H;
      vw = H * va;
    }
    const vx = (W - vw) / 2;
    const vy = (H - vh) / 2;
    if (vw < W - 1) {
      // Video vertikal di 16:9: latar video yang sama digelapkan, bukan pita hitam.
      const sb = Math.max(W / vw0, H / vh0);
      ctx.drawImage(video, (W - vw0 * sb) / 2, (H - vh0 * sb) / 2, vw0 * sb, vh0 * sb);
      ctx.fillStyle = 'rgba(14,23,20,0.72)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(video, vx, vy, vw, vh);
    drawOverlay(ctx, r, fi, vx, vy, vw, vh);
    const gt = ctx.createLinearGradient(0, 0, 0, 150);
    gt.addColorStop(0, 'rgba(14,23,20,0.85)');
    gt.addColorStop(1, 'rgba(14,23,20,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, 150);
    const gb = ctx.createLinearGradient(0, H - 90, 0, H);
    gb.addColorStop(0, 'rgba(14,23,20,0)');
    gb.addColorStop(1, 'rgba(14,23,20,0.85)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, H - 90, W, 90);

    // Header kiri + label kanan.
    brand(ctx, M, 58, 30);
    ctx.textAlign = 'left';
    ctx.font = F(600, 15);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(clip(ctx, r.title, 420), M, 82);
    pillRight(ctx, W - M, 46, 'AI MATCH ANALYSIS', 13);
    if (r.style?.shotPos === 'panel') drawShotBanner(ctx, r, exportTime ?? r.frames[fi]?.t ?? 0, W / 2, 48, 22);

    // Kolom kiri: statistik + daftar pemain.
    const LW = 360;
    const rowH = 38;
    const ky = 104;
    const kh = 86 + st.players.length * rowH + 10;
    panel(ctx, M, ky, LW, kh, 18);
    stat(ctx, M + LW / 4, ky + 50, String(totalHits), 'PUKULAN', LIME, 38);
    stat(ctx, M + (LW * 3) / 4, ky + 50, String(st.rallies), 'RELI', '#ffffff', 38);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M + 16, ky + 84);
    ctx.lineTo(M + LW - 16, ky + 84);
    ctx.stroke();
    st.players.forEach((p, i) => {
      const y = ky + 86 + i * rowH + rowH / 2;
      ctx.fillStyle = PLAYER_COLORS[i % 4];
      ctx.beginPath();
      ctx.arc(M + 22, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = F(700, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(clip(ctx, r.names[i] ?? `Pemain ${i + 1}`, 120), M + 36, y);
      ctx.textAlign = 'right';
      ctx.font = F(700, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${p.hits} pkl · ${fmt1(p.distance)} m${showKcal ? ` · ${fmt1(p.kcal)} kkal` : ''}`, M + LW - 16, y);
      ctx.textBaseline = 'alphabetic';
    });

    // Kolom kanan: peringkat (opsional) + peta mini.
    const RW = 300;
    let ry = 104;
    if (rk) {
      drawRanking(ctx, rk, W - M - RW, ry, RW, 214);
      ry += 214 + G;
    }
    const mh = Math.min(260, H - 70 - ry);
    const mw = Math.round(mh * 0.62);
    panel(ctx, W - M - mw, ry, mw, mh, 18);
    drawMiniCourt(ctx, r, fi, W - M - mw + 6, ry + 6, mw - 12, mh - 12);

    // Footer.
    ctx.textAlign = 'center';
    ctx.font = F(800, 22);
    ctx.fillStyle = LIME;
    ctx.fillText('wins-court.com', W / 2, H - 24);
    ctx.textAlign = 'left';
    ctx.font = F(600, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Beta · perkiraan AI', M, H - 24);
  }
}

function clip(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export function recorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* lanjut */
    }
  }
  return null;
}

/**
 * Rekam video hasil: video asli diputar ulang (real-time) sambil digambar ke kanvas + overlay.
 * Memakai elemen video terpisah supaya pemutar di halaman tidak terganggu.
 */
export async function exportVideo(opts: {
  src: string;
  r: Result;
  layout: 'portrait' | 'landscape';
  showKcal: boolean;
  end: number;
  onProgress: (p: number) => void;
  signal: { cancelled: boolean };
  audio?: AudioContext | null;
}): Promise<{ blob: Blob; mime: string }> {
  const { r, layout } = opts;
  const mime = recorderMime();
  if (!mime) throw new Error('Browser ini belum bisa merekam video. Coba Chrome atau Safari terbaru.');
  // Dipasang di halaman (hampir tak terlihat): browser HP menjeda video yang tidak ada di halaman.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:2147483647';
  document.body.appendChild(holder);
  const video = document.createElement('video');
  holder.appendChild(video);
  video.src = opts.src;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => (holder.remove(), rej(new Error('Video tidak bisa dibaca ulang')));
    video.load();
  });
  const canvas = document.createElement('canvas');
  canvas.width = layout === 'portrait' ? 720 : 1280;
  canvas.height = layout === 'portrait' ? 1280 : 720;
  const ctx = canvas.getContext('2d')!;
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
  // Suara: hanya bila AudioContext benar-benar berjalan. Di iPhone, video yang dialirkan ke
  // AudioContext yang masih "suspended" bisa macet setelah beberapa detik.
  let muted = true;
  if (opts.audio) {
    try {
      if (opts.audio.state !== 'running') await opts.audio.resume();
      if (opts.audio.state === 'running') {
        const srcNode = opts.audio.createMediaElementSource(video);
        const dest = opts.audio.createMediaStreamDestination();
        srcNode.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        muted = false;
      }
    } catch {
      /* tanpa suara */
    }
  }
  video.muted = muted;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: layout === 'portrait' ? 5_000_000 : 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

  await new Promise<void>((res) => {
    video.onseeked = () => res();
    video.currentTime = r.start;
  });
  const t0 = r.start;
  const dur = Math.max(0.5, opts.end - t0);
  drawExportFrame(ctx, video, r, 0, layout, opts.showKcal);

  // Layar tetap menyala selama merekam.
  let lock: { release(): Promise<void> } | null = null;
  try {
    lock = (await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
  } catch {
    /* tidak didukung */
  }

  // Tanpa timeslice: satu file utuh saat berhenti (Safari: durasi & isi file benar).
  try {
    await video.play();
  } catch {
    video.muted = true;
    await video.play();
  }
  // Mulai merekam setelah frame video pertama benar-benar tampil & tergambar (awal video tidak hitam).
  await new Promise<void>((res) => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res());
    else requestAnimationFrame(() => requestAnimationFrame(() => res()));
    setTimeout(res, 500);
  });
  drawExportFrame(ctx, video, r, frameAt(r, video.currentTime), layout, opts.showKcal, video.currentTime);
  rec.start();

  let failure: string | null = null;
  let reached = t0;
  await new Promise<void>((res) => {
    let lastT = video.currentTime;
    let lastMove = performance.now();
    const finish = () => {
      document.removeEventListener('visibilitychange', onHide);
      video.pause();
      res();
    };
    const onHide = () => {
      if (document.hidden) {
        failure = 'Pembuatan video berhenti karena layar mati atau aplikasi ditinggalkan. Ulangi dan biarkan halaman tetap terbuka sampai selesai.';
        finish();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    const tick = () => {
      if (failure) return;
      if (opts.signal.cancelled || video.ended || video.currentTime >= opts.end - 0.05) {
        reached = Math.max(reached, video.ended ? opts.end : video.currentTime);
        return finish();
      }
      const now = performance.now();
      if (video.currentTime > lastT + 0.001) {
        lastT = video.currentTime;
        lastMove = now;
        reached = lastT;
      } else {
        // Browser menjeda video (hemat daya / tersembunyi): putar lagi; bila tetap macet, hentikan dengan pesan.
        if (video.paused) video.play().catch(() => {});
        if (now - lastMove > 4000) {
          failure = `Pemutaran video macet di ${Math.floor(lastT / 60)}:${String(Math.floor(lastT % 60)).padStart(2, '0')}. Coba lagi, atau matikan "Tampilkan kalori"/pilih 16:9 bila HP lambat.`;
          return finish();
        }
      }
      drawExportFrame(ctx, video, r, frameAt(r, video.currentTime), layout, opts.showKcal, video.currentTime);
      opts.onProgress(Math.min(1, (video.currentTime - t0) / dur));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  lock?.release().catch(() => {});
  holder.remove();
  video.removeAttribute('src');
  video.load();
  if (opts.signal.cancelled) throw new Error('Dibatalkan');
  if (failure) throw new Error(failure);
  // Jangan pernah memberikan file yang terpotong diam-diam.
  if (reached - t0 < dur - 1) throw new Error(`Video hanya terekam ${Math.round(reached - t0)} dari ${Math.round(dur)} detik. Ulangi dan biarkan layar tetap terbuka.`);
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime };
}

