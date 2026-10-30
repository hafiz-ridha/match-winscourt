/** Gambar overlay analisis (nama pemain, jejak kok, label pukulan, peta mini) dan ekspor video. */
import { calibMaps, courtLines, COURTS, frameDt, shotLabel, smoothCourt, summarize, type Calib, type Hit, type Pt, type Sport, type Track } from './core.ts';

export const PLAYER_COLORS = ['#C6FF3D', '#2BC58A', '#38BDF8', '#FB923C'];
const INK = '#0E1714';
const LIME = '#C6FF3D';

/** Peringkat dari sesi milik pengguna, ditampilkan di overlay video. */
export interface Ranking {
  session: string;
  sortBy: 'wins' | 'points';
  rows: { rank: number; name: string; played: number; won: number; lost: number; total: number; inMatch: boolean }[];
}

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

export interface OverlayOpts {
  court?: boolean;
  boxes?: boolean;
  selectedHit?: string | null;
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

  // Jejak kok/bola (8 frame terakhir).
  for (let k = 8; k >= 0; k--) {
    const s = r.shuttle[fi - k];
    if (!s) continue;
    const p = P(s);
    ctx.fillStyle = k === 0 ? '#ffffff' : `rgba(198,255,61,${0.75 - k * 0.08})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, k === 0 ? u * 0.42 : u * 0.28, 0, Math.PI * 2);
    ctx.fill();
    if (k === 0) {
      ctx.strokeStyle = LIME;
      ctx.lineWidth = u / 5;
      ctx.stroke();
    }
  }

  // Pemain: elips di kaki + label nama di atas kepala.
  r.tracks.forEach((t, i) => {
    const f = t.frames[fi];
    if (!f) return;
    const c = PLAYER_COLORS[i % 4];
    const foot = P(f.foot);
    ctx.strokeStyle = c;
    ctx.lineWidth = u / 4;
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, Math.max(u, f.box.w * w * 0.55), Math.max(u * 0.35, f.box.w * w * 0.18), 0, 0, Math.PI * 2);
    ctx.stroke();
    if (o.boxes) {
      ctx.strokeStyle = c + '99';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + f.box.x * w, oy + f.box.y * h, f.box.w * w, f.box.h * h);
    }
    const head = P({ x: f.box.x + f.box.w / 2, y: f.box.y });
    pill(ctx, head.x, head.y - u * 1.1, r.names[i] ?? `Pemain ${i + 1}`, c, INK, u * 0.95);
  });

  // Label pukulan selama 0.9 detik setelah pukulan.
  const now = r.frames[fi]?.t ?? 0;
  const recent = r.hits.filter((x) => now - x.t >= 0 && now - x.t < 0.9).slice(-1)[0];
  const sel = o.selectedHit ? r.hits.find((x) => x.id === o.selectedHit) : null;
  for (const hit of [recent, sel].filter(Boolean) as Hit[]) {
    const f = r.tracks[hit.player]?.frames[hit.frame];
    if (!f) continue;
    const p = P({ x: f.box.x + f.box.w / 2, y: f.box.y });
    const a = hit === sel ? 1 : Math.max(0, 1 - (now - hit.t) / 0.9);
    ctx.globalAlpha = a;
    pill(ctx, p.x, p.y - u * 3.1, shotLabel(r.sport, hit.type).toUpperCase(), INK, LIME, u * 1.15);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Peta lapangan mini (tampak atas) dengan posisi & jejak pemain. */
export function drawMiniCourt(ctx: CanvasRenderingContext2D, r: Result, fi: number, x: number, y: number, w: number, h: number) {
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
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
) {
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

/** Satu frame video ekspor (layout 9:16 atau 16:9) dengan grid & margin konsisten. */
export function drawExportFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, r: Result, fi: number, layout: 'portrait' | 'landscape', showKcal: boolean) {
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
    const M = 36;
    const G = 16;
    // Grid: header | blok atas (statistik + peta mini) | video | kartu pemain | footer
    const y0 = 148;
    const TH = 330;
    const RW = 176;
    const LW = W - M * 2 - G - RW;
    const rows = Math.ceil(st.players.length / 2);
    const ch = rows > 1 ? 116 : 136;
    const cardsBottom = H - 88;
    const cardsTop = cardsBottom - rows * ch - (rows - 1) * G;
    const zTop = y0 + TH + G;
    const zBot = cardsTop - G;
    const zH = zBot - zTop;

    // Lapangan dari kalibrasi → pusat potongan video.
    const qx = r.cal.quad.map((p) => p.x);
    const cMin = Math.min(...qx);
    const cMax = Math.max(...qx);
    const cx = (cMin + cMax) / 2;

    // Latar penuh 9:16 (video di-zoom menutupi layar).
    const sBg = Math.max(W / vw0, H / vh0);
    const bw = vw0 * sBg;
    const bh = vh0 * sBg;
    const bx = Math.min(0, Math.max(W - bw, W / 2 - cx * bw));
    const by = (H - bh) / 2;
    ctx.drawImage(video, bx, by, bw, bh);
    let ox = bx;
    let oy = by;
    let ow = bw;
    let oh = bh;
    if (va > 0.8) {
      // Video horizontal: latar digelapkan, video utama di zona tengah, lapangan diperbesar selebar layar.
      ctx.fillStyle = 'rgba(14,23,20,0.7)';
      ctx.fillRect(0, 0, W, H);
      const sCourt = W / ((cMax - cMin + 0.14) * vw0);
      const s = Math.min(Math.max(W / vw0, sCourt), zH / vh0);
      ow = vw0 * s;
      oh = vh0 * s;
      ox = ow > W ? Math.min(0, Math.max(W - ow, W / 2 - cx * ow)) : (W - ow) / 2;
      oy = zTop + (zH - oh) / 2;
      ctx.save();
      roundRect(ctx, Math.max(0, ox), oy, Math.min(W, ow), oh, ow >= W ? 0 : 20);
      ctx.clip();
      ctx.drawImage(video, ox, oy, ow, oh);
      ctx.restore();
    }
    drawOverlay(ctx, r, fi, ox, oy, ow, oh);

    // Gradasi agar teks & kartu terbaca.
    const gt = ctx.createLinearGradient(0, 0, 0, zTop);
    gt.addColorStop(0, 'rgba(14,23,20,0.9)');
    gt.addColorStop(1, 'rgba(14,23,20,0)');
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, zTop);
    const gb = ctx.createLinearGradient(0, zBot - 60, 0, H);
    gb.addColorStop(0, 'rgba(14,23,20,0)');
    gb.addColorStop(0.3, 'rgba(14,23,20,0.75)');
    gb.addColorStop(1, 'rgba(14,23,20,0.95)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, zBot - 60, W, H - zBot + 60);

    // Header.
    brand(ctx, M, 84, 40);
    pillRight(ctx, W - M, 70, 'AI MATCH ANALYSIS', 14);
    ctx.textAlign = 'left';
    ctx.font = F(600, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(clip(ctx, r.title, W - M * 2), M, 116);

    // Blok atas kiri: statistik (+ peringkat bila dipilih).
    ctx.lineWidth = 1.5;
    if (rk) {
      const kh = 104;
      panel(ctx, M, y0, LW, kh);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(M + LW / 2, y0 + 20);
      ctx.lineTo(M + LW / 2, y0 + kh - 20);
      ctx.stroke();
      stat(ctx, M + LW / 4, y0 + 58, String(totalHits), 'PUKULAN', LIME, 46);
      stat(ctx, M + (LW * 3) / 4, y0 + 58, String(st.rallies), 'RELI', '#ffffff', 46);
      drawRanking(ctx, rk, M, y0 + kh + G, LW, TH - kh - G);
    } else {
      panel(ctx, M, y0, LW, TH);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(M + LW / 2, y0 + 24);
      ctx.lineTo(M + LW / 2, y0 + TH - 24);
      ctx.moveTo(M + 24, y0 + TH / 2);
      ctx.lineTo(M + LW - 24, y0 + TH / 2);
      ctx.stroke();
      const c1 = M + LW / 4;
      const c2 = M + (LW * 3) / 4;
      stat(ctx, c1, y0 + 92, String(totalHits), 'PUKULAN', LIME, 60);
      stat(ctx, c2, y0 + 92, String(st.rallies), 'RELI', '#ffffff', 60);
      stat(ctx, c1, y0 + TH / 2 + 92, String(st.longestRally), 'RELI TERPANJANG', '#ffffff', 60);
      stat(ctx, c2, y0 + TH / 2 + 92, mmss(st.duration), 'DURASI', '#ffffff', 60);
    }
    // Blok atas kanan: peta mini setinggi blok kiri.
    panel(ctx, W - M - RW, y0, RW, TH);
    drawMiniCourt(ctx, r, fi, W - M - RW + 8, y0 + 8, RW - 16, TH - 16);

    // Kartu pemain.
    const cw = (W - M * 2 - G) / 2;
    st.players.forEach((p, i) => {
      playerCard(ctx, M + (i % 2) * (cw + G), cardsTop + Math.floor(i / 2) * (ch + G), cw, ch, i, r.names[i] ?? `Pemain ${i + 1}`, p, showKcal);
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
    // 16:9 — elemen di empat sudut, bagian tengah & atas tetap lega untuk video.
    const M = 28;
    let vw = W;
    let vh = W / va;
    if (vh > H) {
      vh = H;
      vw = H * va;
    }
    const vx = (W - vw) / 2;
    const vy = (H - vh) / 2;
    ctx.drawImage(video, vx, vy, vw, vh);
    drawOverlay(ctx, r, fi, vx, vy, vw, vh);
    const gb = ctx.createLinearGradient(0, H - 80, 0, H);
    gb.addColorStop(0, 'rgba(14,23,20,0)');
    gb.addColorStop(1, 'rgba(14,23,20,0.75)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, H - 80, W, 80);

    // Atas kiri: satu kartu ringkas — merek + pukulan & reli.
    const SW = 300;
    const SH = 92;
    panel(ctx, M, M, SW, SH, 18);
    brand(ctx, M + 18, M + 34, 22);
    ctx.textAlign = 'right';
    ctx.font = F(800, 10);
    ctx.fillStyle = LIME;
    ctx.fillText('AI MATCH ANALYSIS', M + SW - 18, M + 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M + 18, M + 46);
    ctx.lineTo(M + SW - 18, M + 46);
    ctx.stroke();
    const inline = (x: number, value: string, label: string, color: string) => {
      ctx.textAlign = 'left';
      ctx.font = F(800, 26);
      ctx.fillStyle = color;
      ctx.fillText(value, x, M + 80);
      const w = ctx.measureText(value).width;
      ctx.font = F(700, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(label, x + w + 8, M + 79);
    };
    inline(M + 18, String(totalHits), 'PUKULAN', LIME);
    inline(M + SW / 2 + 10, String(st.rallies), 'RELI', '#ffffff');

    // Bawah kiri: daftar pemain.
    const rowH = 32;
    const PH = 16 + st.players.length * rowH;
    const py = H - 52 - PH;
    panel(ctx, M, py, SW, PH, 18);
    st.players.forEach((p, i) => {
      const y = py + 8 + i * rowH + rowH / 2;
      ctx.fillStyle = PLAYER_COLORS[i % 4];
      ctx.beginPath();
      ctx.arc(M + 20, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = F(700, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(clip(ctx, r.names[i] ?? `Pemain ${i + 1}`, 104), M + 32, y);
      ctx.textAlign = 'right';
      ctx.font = F(600, 13);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(`${p.hits} pkl · ${fmt1(p.distance)} m${showKcal ? ` · ${fmt1(p.kcal)} kkal` : ''}`, M + SW - 16, y);
      ctx.textBaseline = 'alphabetic';
    });

    // Atas kanan: peringkat (opsional). Bawah kanan: peta mini.
    if (rk) drawRanking(ctx, rk, W - M - 280, M, 280, 186);
    const mh = 200;
    const mw = 124;
    panel(ctx, W - M - mw, H - 52 - mh, mw, mh, 18);
    drawMiniCourt(ctx, r, fi, W - M - mw + 5, H - 52 - mh + 5, mw - 10, mh - 10);

    // Footer.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = F(800, 20);
    ctx.fillStyle = LIME;
    ctx.fillText('wins-court.com', W / 2, H - 20);
    ctx.textAlign = 'left';
    ctx.font = F(600, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Beta · perkiraan AI', M, H - 20);
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
  const video = document.createElement('video');
  video.src = opts.src;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error('Video tidak bisa dibaca ulang'));
    video.load();
  });
  const canvas = document.createElement('canvas');
  canvas.width = layout === 'portrait' ? 720 : 1280;
  canvas.height = layout === 'portrait' ? 1280 : 720;
  const ctx = canvas.getContext('2d')!;
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
  let muted = true;
  if (opts.audio) {
    try {
      const srcNode = opts.audio.createMediaElementSource(video);
      const dest = opts.audio.createMediaStreamDestination();
      srcNode.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      muted = false;
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
  rec.start(500);
  try {
    await video.play();
  } catch {
    video.muted = true;
    await video.play();
  }
  await new Promise<void>((res) => {
    const tick = () => {
      if (opts.signal.cancelled || video.ended || video.currentTime >= opts.end) {
        video.pause();
        return res();
      }
      drawExportFrame(ctx, video, r, frameAt(r, video.currentTime), layout, opts.showKcal);
      opts.onProgress(Math.min(1, (video.currentTime - t0) / dur));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  video.removeAttribute('src');
  video.load();
  if (opts.signal.cancelled) throw new Error('Dibatalkan');
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), mime };
}
