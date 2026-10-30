/** Gambar overlay analisis (nama pemain, jejak kok, label pukulan, peta mini) dan ekspor video. */
import { calibMaps, courtLines, COURTS, frameDt, shotLabel, smoothCourt, summarize, type Calib, type Hit, type Pt, type Sport, type Track } from './core.ts';

export const PLAYER_COLORS = ['#C6FF3D', '#2BC58A', '#38BDF8', '#FB923C'];
const INK = '#0E1714';
const LIME = '#C6FF3D';

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

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

/** Satu frame video ekspor (layout 9:16 atau 16:9). */
export function drawExportFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, r: Result, fi: number, layout: 'portrait' | 'landscape', showKcal: boolean) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const st = summarize(r.frames, r.tracks, r.hits, r.sport, r.teamSize, r.weights, fi);
  const totalHits = st.players.reduce((n, p) => n + p.hits, 0);
  const va = video.videoWidth / video.videoHeight || 16 / 9;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);

  const font = (wgt: number, size: number) => `${wgt} ${size}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  const brand = (x: number, y: number, size: number) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(800, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('match.', x, y);
    const w1 = ctx.measureText('match.').width;
    ctx.fillStyle = LIME;
    ctx.fillText('wins-court.com', x + w1, y);
  };

  if (layout === 'portrait') {
    // Cahaya lime lembut di atas (gaya wins-court.com).
    const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, 0, W * 0.9);
    g.addColorStop(0, 'rgba(198,255,61,0.18)');
    g.addColorStop(1, 'rgba(198,255,61,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.5);
    brand(40, 78, 34);
    ctx.font = font(600, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(r.title, 40, 116);
    pill(ctx, W - 100, 66, 'ANALISIS RELI', LIME, INK, 16);

    const vy = 150;
    let vw = W;
    let vh = W / va;
    if (vh > 560) {
      vh = 560;
      vw = vh * va;
    }
    const vx = (W - vw) / 2;
    ctx.drawImage(video, vx, vy, vw, vh);
    drawOverlay(ctx, r, fi, vx, vy, vw, vh);

    // Penghitung besar.
    const ty = vy + vh + 40;
    ctx.textAlign = 'left';
    ctx.font = font(800, 76);
    ctx.fillStyle = LIME;
    ctx.fillText(String(totalHits), 40, ty + 62);
    ctx.font = font(700, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('PUKULAN', 40, ty + 100);
    ctx.font = font(800, 44);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(st.rallies), 210, ty + 62);
    ctx.font = font(700, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('RELI', 210, ty + 100);
    drawMiniCourt(ctx, r, fi, W - 230, ty - 10, 200, 300);

    // Kartu pemain.
    const cy0 = Math.max(ty + 130, ty + 300);
    const n = r.tracks.length;
    const cols = 2;
    const gap = 16;
    const cw = (W - 80 - gap) / cols;
    const ch = n > 2 ? 150 : 170;
    st.players.forEach((p, i) => {
      const x = 40 + (i % cols) * (cw + gap);
      const y = cy0 + Math.floor(i / cols) * (ch + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, x, y, cw, ch, 22);
      ctx.fill();
      ctx.fillStyle = PLAYER_COLORS[i % 4];
      ctx.beginPath();
      ctx.arc(x + 28, y + 34, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(800, 24);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(clip(ctx, r.names[i] ?? `Pemain ${i + 1}`, cw - 70), x + 46, y + 43);
      const stats: [string, string][] = [
        [String(p.hits), 'pukulan'],
        [fmt1(p.distance), 'meter'],
      ];
      if (showKcal) stats.push([fmt1(p.kcal), 'kkal']);
      const sw = (cw - 40) / stats.length;
      stats.forEach(([v, l], k) => {
        ctx.font = font(800, 36);
        ctx.fillStyle = k === 0 ? LIME : '#ffffff';
        ctx.fillText(v, x + 22 + k * sw, y + ch - 46);
        ctx.font = font(600, 17);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(l, x + 22 + k * sw, y + ch - 20);
      });
    });
    ctx.font = font(600, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('Beta · angka perkiraan AI dari video', W / 2, H - 28);
  } else {
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
    // Panel kiri atas.
    const rows = st.players.length;
    const pw = 360;
    const ph = 64 + rows * 44;
    ctx.fillStyle = 'rgba(14,23,20,0.82)';
    roundRect(ctx, 24, 24, pw, ph, 20);
    ctx.fill();
    brand(44, 62, 22);
    ctx.font = font(800, 22);
    ctx.fillStyle = LIME;
    ctx.textAlign = 'right';
    ctx.fillText(`${totalHits} pukulan`, 24 + pw - 20, 62);
    st.players.forEach((p, i) => {
      const y = 104 + i * 44;
      ctx.fillStyle = PLAYER_COLORS[i % 4];
      ctx.beginPath();
      ctx.arc(52, y - 7, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = font(700, 19);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(clip(ctx, r.names[i] ?? `Pemain ${i + 1}`, 130), 68, y);
      ctx.textAlign = 'right';
      ctx.font = font(700, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${p.hits} · ${fmt1(p.distance)} m${showKcal ? ` · ${fmt1(p.kcal)} kkal` : ''}`, 24 + pw - 20, y);
    });
    // Peta mini kanan bawah.
    ctx.fillStyle = 'rgba(14,23,20,0.82)';
    roundRect(ctx, W - 200, H - 300, 176, 276, 20);
    ctx.fill();
    drawMiniCourt(ctx, r, fi, W - 200, H - 300, 176, 276);
    ctx.font = font(600, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('Beta · perkiraan AI', 28, H - 22);
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
