/**
 * Mesin analisis di HP (tanpa server, video tidak diunggah):
 *  - Pemain: MediaPipe Pose Landmarker (GPU/WebGL bila ada), dijalankan terpisah untuk sisi dekat
 *    & sisi jauh lapangan supaya pemain yang jauh tetap cukup besar untuk dikenali.
 *  - Kok/bola: deteksi benda kecil yang bergerak (selisih 3 frame) → kandidat untuk pelacak lintasan.
 *  - Gerak kamera: diperkirakan per frame supaya rekaman HP yang dipegang tangan tetap bisa dipakai.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { CAM_ID, camCompose, estimateMotion, sideRegion, type Blob, type Cam, type Calib, type FrameObs, type PoseObs } from './core.ts';

const MP_VERSION = '1.1.1';
// Disajikan dari domain sendiri (lihat vite.config.ts & server/models.ts).
const WASM = `/mediapipe/${MP_VERSION}`;
const MODEL = {
  full: '/models/pose_landmarker_full.task',
  lite: '/models/pose_landmarker_lite.task',
};
/** Model "heavy" (±30 MB): diunduh hanya bila pengguna memilihnya, disimpan di HP (Cache Storage). */
export const HEAVY_URL = '/models/pose_landmarker_heavy.task';
const HEAVY_CACHE = 'mwc-models-v1';

/** Model heavy sudah tersimpan di HP ini? */
export async function heavyReady(): Promise<boolean> {
  try {
    return !!(await (await caches.open(HEAVY_CACHE)).match(HEAVY_URL));
  } catch {
    return false;
  }
}

/** Unduh model heavy sekali (dengan kemajuan 0–1) lalu simpan di HP. */
export async function downloadHeavy(onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(HEAVY_URL, { signal });
  if (!res.ok || !res.body) throw new Error('Model belum bisa diunduh. Coba lagi sebentar.');
  const total = Number(res.headers.get('content-length')) || 30_000_000;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  const blob = new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
  const cache = await caches.open(HEAVY_CACHE);
  await cache.put(HEAVY_URL, new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size) } }));
}

export async function removeHeavy() {
  try {
    await (await caches.open(HEAVY_CACHE)).delete(HEAVY_URL);
  } catch {
    /* tidak didukung */
  }
}

async function heavyBuffer(): Promise<Uint8Array | null> {
  try {
    const r = await (await caches.open(HEAVY_CACHE)).match(HEAVY_URL);
    return r ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/**
 * Frame per detik asli video (24/25/30/50/60): video di-seek per 1/120 dtk dalam beberapa jendela
 * pendek, lalu dihitung berapa kali gambarnya berganti. Tidak perlu video tampil di layar.
 * null bila tidak bisa diukur (mis. adegan diam).
 */
export async function detectFps(video: HTMLVideoElement): Promise<number | null> {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 27;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const sig = () => {
    ctx.drawImage(video, 0, 0, 48, 27);
    const d = ctx.getImageData(0, 0, 48, 27).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    return h;
  };
  const was = video.currentTime;
  const dur = Number.isFinite(video.duration) ? video.duration : 0;
  const best: number[] = [];
  try {
    for (const start of [0.6, 0.3].map((q) => q * Math.max(0, dur - 0.6))) {
      let changes = 0;
      let prev = -1;
      const N = 48; // 0,4 dtk
      for (let i = 0; i <= N; i++) {
        await seek(video, start + i / 120);
        const h = sig();
        if (prev >= 0 && h !== prev) changes++;
        prev = h;
      }
      best.push(changes / (N / 120));
    }
  } catch {
    return null;
  } finally {
    await seek(video, was);
  }
  const fps = Math.max(...best);
  if (!(fps >= 10)) return null;
  return [24, 25, 30, 50, 60].reduce((b, x) => (Math.abs(x - fps) < Math.abs(b - fps) ? x : b), 30);
}

export interface Engine {
  near: PoseLandmarker;
  /** Satu pelacak per potongan sisi jauh (kiri → kanan). */
  far: PoseLandmarker[];
  delegate: 'GPU' | 'CPU';
  /** Mode akurasi tinggi. */
  hq: boolean;
  /** Sisi jauh memakai model heavy. */
  heavy: boolean;
  close(): void;
}

/**
 * Jumlah potongan sisi jauh. Model pose melihat gambar ±224 px, jadi potongan yang lebar & pendek
 * membuat pemain jauh tampak sangat kecil. Potongan dibagi kiri-kanan supaya mendekati persegi:
 * maks 2 di mode biasa (hanya bila sangat lebar), maks 3 di mode akurasi tinggi.
 */
export function farTileCount(cal: Calib, videoW: number, videoH: number, hq: boolean) {
  const r = sideRegion(cal, 'far');
  const ar = (r.w * videoW) / Math.max(1, r.h * videoH);
  return hq ? Math.max(2, Math.min(3, Math.ceil(ar / 1.3))) : ar > 2.2 ? 2 : 1;
}

export async function loadEngine(teamSize: 1 | 2, onStatus?: (s: string) => void, hq = false, farTiles = 1, useHeavy = false): Promise<Engine> {
  onStatus?.('Memuat mesin AI…');
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  // Potongan sisi dekat juga memuat pemain jauh (di atasnya) → jatah pose lebih banyak supaya
  // kedua pemain dekat tidak tersisih.
  // Model heavy (bila dipilih & sudah diunduh) dipakai untuk sisi jauh: pemain kecil / tertutup net.
  const heavyBuf = hq && useHeavy ? await heavyBuffer() : null;
  const make = async (delegate: 'GPU' | 'CPU', model: string | Uint8Array, numPoses = teamSize + 1) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: typeof model === 'string' ? { modelAssetPath: model, delegate } : { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  onStatus?.('Mengunduh model pelacak pemain (sekali saja)…');
  try {
    const near = await make('GPU', MODEL.full, teamSize * 2 + 1);
    const far: PoseLandmarker[] = [];
    if (heavyBuf) onStatus?.('Memuat model AI paling teliti (heavy)…');
    for (let i = 0; i < farTiles; i++) far.push(await make('GPU', heavyBuf ?? MODEL.full));
    return { near, far, hq, heavy: !!heavyBuf, delegate: 'GPU', close: () => [near, ...far].forEach((x) => x.close()) };
  } catch {
    onStatus?.('GPU tidak tersedia, memakai mode CPU (lebih lambat)…');
    // Mode CPU: model "full" hanya dipakai di mode akurasi tinggi (jauh lebih lambat).
    const model = hq ? MODEL.full : MODEL.lite;
    const near = await make('CPU', model, teamSize * 2 + 1);
    const far: PoseLandmarker[] = [];
    for (let i = 0; i < farTiles; i++) far.push(await make('CPU', heavyBuf ?? model));
    return { near, far, hq, heavy: !!heavyBuf, delegate: 'CPU', close: () => [near, ...far].forEach((x) => x.close()) };
  }
}

/** Seek video ke waktu t dan tunggu frame siap digambar. */
export function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    // Setelah 'seeked' frame sudah bisa digambar ke kanvas (Chrome & Safari).
    // requestVideoFrameCallback sengaja tidak dipakai: video tersembunyi tidak dikomposit → +200 ms/frame.
    const onSeeked = () => finish();
    video.addEventListener('seeked', onSeeked);
    setTimeout(finish, 3000);
    video.currentTime = t;
  });
}

type Region = ReturnType<typeof sideRegion>;
type Shift = { dx: number; dy: number };

export class FrameProcessor {
  private crop = document.createElement('canvas');
  private small = document.createElement('canvas');
  /** Kanvas kecil (lebar 320) khusus memperkirakan gerak kamera — murah walau kanvas kok besar. */
  private camCanvas = document.createElement('canvas');
  private camPrev: Uint8ClampedArray | null = null;
  private camH: number;
  private prev: Uint8ClampedArray[] = [];
  private prevShift: Shift[] = [];
  private regions: { near: Region; far: Region[] };
  private ts = 0;
  private motionW: number;
  private motionH: number;
  /** Gerak kamera kumulatif: frame ini → frame pertama (isotropik ternormalisasi). */
  private cam: Cam = [...CAM_ID];
  /** Jumlah frame yang gerak kameranya tidak bisa diperkirakan. */
  camFails = 0;

  private engine: Engine;
  private video: HTMLVideoElement;
  private aspect: number;

  constructor(engine: Engine, video: HTMLVideoElement, cal: Calib) {
    this.engine = engine;
    this.video = video;
    this.aspect = cal.aspect;
    const far = sideRegion(cal, 'far');
    // Sisi jauh dipotong n bagian kiri-kanan yang bertumpuk 25% → tiap pemain jauh tampil lebih besar.
    const n = Math.max(1, engine.far.length);
    const tw = far.w / (n - 0.25 * (n - 1));
    this.regions = {
      near: sideRegion(cal, 'near'),
      far: Array.from({ length: n }, (_, i) => ({ ...far, x: far.x + i * tw * 0.75, w: tw })),
    };
    // Kok/bola sangat kecil: di mode akurasi tinggi dicari di resolusi asli video (maks. lebar 960).
    this.motionW = engine.hq ? Math.max(320, Math.min(960, video.videoWidth || 960)) : 320;
    this.motionH = Math.round(this.motionW / cal.aspect);
    this.small.width = this.motionW;
    this.small.height = this.motionH;
    this.camH = Math.round(320 / cal.aspect);
    this.camCanvas.width = 320;
    this.camCanvas.height = this.camH;
  }

  reset() {
    this.camPrev = null;
    this.prev = [];
    this.prevShift = [];
    this.cam = [...CAM_ID];
  }

  /** Proses frame video saat ini. */
  process(t: number): FrameObs {
    const near = this.poseIn(this.regions.near, this.engine.near);
    // Orang di daerah tumpukan potongan terdeteksi 2× → ambil yang paling yakin.
    const all = this.regions.far.flatMap((r, i) => this.poseIn(r, this.engine.far[i])).sort((p, q) => q.score - p.score);
    const farAll = all.filter(
      (p, i) => all.findIndex((q) => Math.hypot((q.foot.x - p.foot.x) * this.aspect, q.foot.y - p.foot.y) < Math.max(0.02, p.box.h * 0.25)) === i,
    );
    // Kamera rendah: badan atas pemain dekat ikut masuk potongan "sisi jauh". Deteksi jauh yang
    // bertumpuk dengan pemain dekat dibuang supaya tidak terbaca sebagai pemain jauh.
    const far = farAll.filter(
      (f) =>
        !near.some((n) => {
          const cx = f.box.x + f.box.w / 2;
          const cy = f.box.y + f.box.h / 2;
          return cx > n.box.x - n.box.w * 0.1 && cx < n.box.x + n.box.w * 1.1 && cy > n.box.y - n.box.h * 0.1 && cy < n.box.y + n.box.h * 1.1;
        }),
    );
    const poses = [...near, ...far];
    const blobs = this.motion(poses);
    return { t, poses, blobs, cam: [...this.cam] as Cam };
  }

  private poseIn(r: Region, lm: PoseLandmarker): PoseObs[] {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const sx = r.x * vw;
    const sy = r.y * vh;
    const sw = r.w * vw;
    const sh = r.h * vh;
    // Potongan diperbesar ke ±512 px sisi terpanjang (pemain jauh jadi lebih jelas).
    const scale = 512 / Math.max(sw, sh);
    const cw = Math.max(64, Math.round(sw * scale));
    const ch = Math.max(64, Math.round(sh * scale));
    if (this.crop.width !== cw || this.crop.height !== ch) {
      this.crop.width = cw;
      this.crop.height = ch;
    }
    const ctx = this.crop.getContext('2d', { willReadFrequently: this.engine.hq })!;
    ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, cw, ch);
    this.ts += 33;
    let res;
    try {
      res = lm.detectForVideo(this.crop, this.ts);
    } catch {
      return [];
    }
    const map = (p: { x: number; y: number }) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h });
    const out: PoseObs[] = [];
    for (const l of res.landmarks ?? []) {
      const pts = l.map(map);
      const vis = l.map((p) => p.visibility ?? 1);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const inCrop = (i: number) => l[i].y >= 0 && l[i].y <= 0.97;
      let score = vis.slice(11, 29).reduce((a, b) => a + b, 0) / 18;
      // Posisi di lapangan diambil dari KAKI. Kaki yang terpotong tepi bawah potongan tidak dipakai
      // (titik tebakannya jatuh di tempat yang salah).
      const footIdx = [27, 28, 29, 30, 31, 32].filter((i) => vis[i] > 0.35 && inCrop(i));
      let foot: { x: number; y: number };
      let est = false;
      if (footIdx.length) {
        foot = { x: footIdx.reduce((s, i) => s + pts[i].x, 0) / footIdx.length, y: Math.max(...footIdx.map((i) => pts[i].y)) };
      } else {
        // Kaki tertutup (pemain jauh di balik net): perkirakan dari lutut, atau dari pinggul + panjang badan.
        if (!(vis[23] > 0.5 && vis[24] > 0.5 && inCrop(23) && inCrop(24))) continue;
        const shs = [11, 12].filter((i) => vis[i] > 0.5 && inCrop(i));
        if (!shs.length) continue;
        const hy = (pts[23].y + pts[24].y) / 2;
        const hx = (pts[23].x + pts[24].x) / 2;
        const torso = hy - shs.reduce((s, i) => s + pts[i].y, 0) / shs.length;
        if (torso <= 0.005) continue;
        const knees = [25, 26].filter((i) => vis[i] > 0.6 && inCrop(i) && pts[i].y > hy).map((i) => pts[i].y);
        // Paha ≈ betis; tinggi pinggul dari lantai ≈ 1,75× panjang badan (bahu–pinggul).
        const fy = knees.length ? Math.max(...knees) + (Math.max(...knees) - hy) * 0.95 : hy + torso * 1.75;
        foot = { x: hx, y: fy };
        est = true;
        score *= 0.8;
      }
      const top = Math.min(...ys);
      const color = this.engine.hq ? this.torsoColor(ctx, l, cw, ch) : undefined;
      out.push({
        foot,
        box: { x: Math.min(...xs), y: top, w: Math.max(...xs) - Math.min(...xs), h: Math.max(foot.y, ...ys) - top },
        wristL: pts[15],
        wristR: pts[16],
        shoulderL: pts[11],
        shoulderR: pts[12],
        nose: pts[0],
        score,
        est,
        color,
      });
    }
    return out;
  }

  /**
   * "Sidik warna" baju: histogram warna badan (bahu–pinggul) dari potongan gambar — 8 kelompok
   * hue untuk warna jenuh + 3 kelompok gelap/sedang/terang untuk hitam, abu, putih. Jumlah = 1.
   */
  private torsoColor(ctx: CanvasRenderingContext2D, l: { x: number; y: number }[], cw: number, ch: number): number[] | undefined {
    const xs = [l[11].x, l[12].x, l[23].x, l[24].x];
    const ys = [l[11].y, l[12].y, l[23].y, l[24].y];
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    // Bagian tengah badan saja (tanpa lengan & latar di tepi).
    const mx = (x1 - x0) * 0.15;
    const my = (y1 - y0) * 0.1;
    x0 = Math.max(0, Math.floor((x0 + mx) * cw));
    x1 = Math.min(cw, Math.ceil((x1 - mx) * cw));
    y0 = Math.max(0, Math.floor((y0 + my) * ch));
    y1 = Math.min(ch, Math.ceil((y1 - my) * ch));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 3 || h < 3) return undefined;
    let d: Uint8ClampedArray;
    try {
      d = ctx.getImageData(x0, y0, w, h).data;
    } catch {
      return undefined;
    }
    const hist = new Array(11).fill(0);
    let n = 0;
    const step = Math.max(1, Math.floor((w * h) / 600)) * 4;
    for (let i = 0; i < d.length; i += step) {
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      const mxv = Math.max(r, g, b);
      const mnv = Math.min(r, g, b);
      const sat = mxv ? (mxv - mnv) / mxv : 0;
      if (sat > 0.25 && mxv > 0.2) {
        let hue = 0;
        const dl = mxv - mnv;
        if (mxv === r) hue = ((g - b) / dl + 6) % 6;
        else if (mxv === g) hue = (b - r) / dl + 2;
        else hue = (r - g) / dl + 4;
        hist[Math.min(7, Math.floor((hue / 6) * 8))]++;
      } else hist[mxv < 0.3 ? 8 : mxv < 0.7 ? 9 : 10]++;
      n++;
    }
    return n ? hist.map((v) => v / n) : undefined;
  }

  /**
   * Kandidat kok/bola: piksel yang berbeda dari 2 frame sebelumnya (setelah gerak kamera dibuang),
   * dikelompokkan jadi blob kecil. Sekaligus memperkirakan gerak kamera.
   */
  private motion(poses: PoseObs[]): Blob[] {
    const W = this.motionW;
    const H = this.motionH;
    const ctx = this.small.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.video, 0, 0, W, H);
    const rgba = ctx.getImageData(0, 0, W, H).data;
    let g: Uint8ClampedArray = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    // Resolusi tinggi: haluskan 3×3 supaya noise kompresi video tidak terbaca sebagai gerak.
    if (W > 320) g = blur3(g, W, H);
    // Frame kembar (video asli lebih jarang dari laju sampel): lewati, jangan dijadikan pembanding.
    if (this.prev[0] && sameFrame(g, this.prev[0])) return [];
    const [p1, p2] = this.prev;
    // Gerak kamera frame ini → frame sebelumnya, diperkirakan di kanvas kecil 320 px (murah), lalu
    // dijumlahkan ke kumulatif. Geseran diskalakan ke resolusi kanvas kok.
    const CW = 320;
    const CH = this.camH;
    let gc: Uint8ClampedArray;
    if (W === CW) gc = g;
    else {
      const cctx = this.camCanvas.getContext('2d', { willReadFrequently: true })!;
      cctx.drawImage(this.video, 0, 0, CW, CH);
      const cd = cctx.getImageData(0, 0, CW, CH).data;
      gc = new Uint8ClampedArray(CW * CH);
      for (let i = 0, j = 0; j < gc.length; i += 4, j++) gc[j] = (cd[i] * 77 + cd[i + 1] * 150 + cd[i + 2] * 29) >> 8;
    }
    let shift: Shift = { dx: 0, dy: 0 };
    if (this.camPrev) {
      const m = estimateMotion(gc, this.camPrev, CW, CH);
      if (m) {
        const [a, b, tx, ty] = m.cam;
        this.cam = camCompose(this.cam, [a, b, tx / CH, ty / CH]);
        // Geser rata-rata di tengah frame (untuk selisih frame; putaran kecil diabaikan).
        const cx = CW / 2;
        const cy = CH / 2;
        const k = W / CW;
        shift = { dx: Math.round((a * cx - b * cy + tx - cx) * k), dy: Math.round((b * cx + a * cy + ty - cy) * k) };
      } else this.camFails++;
    }
    this.camPrev = gc;
    const s1 = shift;
    const s2 = this.prevShift[0] ? { dx: s1.dx + this.prevShift[0].dx, dy: s1.dy + this.prevShift[0].dy } : s1;
    this.prev = [g, p1].filter(Boolean) as Uint8ClampedArray[];
    this.prevShift = [shift];
    if (!p1 || !p2) return [];
    const TH = 22;
    const mask = new Uint8Array(W * H);
    let on = 0;
    for (let y = 0; y < H; y++) {
      const y1 = y + s1.dy;
      const y2 = y + s2.dy;
      if (y1 < 0 || y1 >= H || y2 < 0 || y2 >= H) continue;
      for (let x = 0; x < W; x++) {
        const x1 = x + s1.dx;
        const x2 = x + s2.dx;
        if (x1 < 0 || x1 >= W || x2 < 0 || x2 >= W) continue;
        const j = y * W + x;
        const v = g[j];
        if (Math.abs(v - p1[y1 * W + x1]) > TH && Math.abs(v - p2[y2 * W + x2]) > TH) {
          mask[j] = 1;
          on++;
        }
      }
    }
    // Kamera goyang keras / ganti pencahayaan → abaikan frame.
    if (on > g.length * 0.06) return [];
    const blobs: Blob[] = [];
    const stack: number[] = [];
    const k = W / 320;
    const maxS = Math.round(22 * k);
    const maxA = Math.round(90 * k * k);
    for (let j = 0; j < mask.length; j++) {
      if (mask[j] !== 1) continue;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let lum = 0;
      let bg = 0;
      let minX = W;
      let maxX = 0;
      let minY = H;
      let maxY = 0;
      stack.push(j);
      mask[j] = 2;
      while (stack.length) {
        const q = stack.pop()!;
        const x = q % W;
        const y = (q - x) / W;
        n++;
        sx += x;
        sy += y;
        lum += g[q];
        bg += p1[(y + s1.dy) * W + x + s1.dx] ?? g[q];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[q - 1] === 1) (mask[q - 1] = 2), stack.push(q - 1);
        if (x < W - 1 && mask[q + 1] === 1) (mask[q + 1] = 2), stack.push(q + 1);
        if (y > 0 && mask[q - W] === 1) (mask[q - W] = 2), stack.push(q - W);
        if (y < H - 1 && mask[q + W] === 1) (mask[q + W] = 2), stack.push(q + W);
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // Kok/bola: kecil (bisa memanjang karena blur gerak), bukan potongan badan.
      if (n >= Math.max(2, Math.round(k)) && n <= maxA && bw <= maxS && bh <= maxS) blobs.push({ x: sx / n / W, y: sy / n / H, area: n / (k * k), contrast: (lum - bg) / n });
    }
    // Serpihan di dalam badan pemain (baju, kaki, tangan) bukan kok/bola. Kok yang menempel di raket
    // biasanya di luar kotak badan, jadi tetap tersimpan.
    const free = blobs.filter(
      (b) => !poses.some((p) => b.x > p.box.x + p.box.w * 0.1 && b.x < p.box.x + p.box.w * 0.9 && b.y > p.box.y + p.box.h * 0.1 && b.y < p.box.y + p.box.h),
    );
    const cap = Math.round(30 * k);
    if (free.length <= cap) return free;
    // Mode biasa: terlalu banyak = frame berisik (kamera goyang / kilau lampu) → tidak dipakai.
    if (!this.engine.hq) return [];
    // Akurasi tinggi: simpan kandidat paling mirip kok/bola (kecil & lebih terang dari latar);
    // pelacak lintasan menyaring sisanya (harus terbang, tidak diam, tidak di badan pemain).
    return free.sort((p, q) => (q.contrast ?? 0) - q.area * 0.3 - ((p.contrast ?? 0) - p.area * 0.3)).slice(0, cap);
  }
}

/** Blur kotak 3×3 (dua lintasan) untuk citra abu-abu. */
function blur3(src: Uint8ClampedArray, W: number, H: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const a = src[r + Math.max(0, x - 1)];
      const b = src[r + Math.min(W - 1, x + 1)];
      tmp[r + x] = (a + src[r + x] + b) / 3;
    }
  }
  for (let y = 0; y < H; y++) {
    const u = Math.max(0, y - 1) * W;
    const d = Math.min(H - 1, y + 1) * W;
    const r = y * W;
    for (let x = 0; x < W; x++) out[r + x] = (tmp[u + x] + tmp[r + x] + tmp[d + x]) / 3;
  }
  return out;
}

/** Dua frame praktis identik (rata-rata selisih < 0,4 tingkat abu-abu, dicek jarang). */
function sameFrame(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 37) {
    s += Math.abs(a[i] - b[i]);
    n++;
  }
  return s / n < 0.4;
}
