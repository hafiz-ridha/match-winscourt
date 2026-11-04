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

export interface Engine {
  near: PoseLandmarker;
  /** Satu pelacak per potongan sisi jauh (kiri → kanan). */
  far: PoseLandmarker[];
  delegate: 'GPU' | 'CPU';
  /** Mode akurasi tinggi. */
  hq: boolean;
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

export async function loadEngine(teamSize: 1 | 2, onStatus?: (s: string) => void, hq = false, farTiles = 1): Promise<Engine> {
  onStatus?.('Memuat mesin AI…');
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  // Potongan sisi dekat juga memuat pemain jauh (di atasnya) → jatah pose lebih banyak supaya
  // kedua pemain dekat tidak tersisih.
  const make = async (delegate: 'GPU' | 'CPU', model: string, numPoses = teamSize + 1) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate },
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
    for (let i = 0; i < farTiles; i++) far.push(await make('GPU', MODEL.full));
    return { near, far, hq, delegate: 'GPU', close: () => [near, ...far].forEach((x) => x.close()) };
  } catch {
    onStatus?.('GPU tidak tersedia, memakai mode CPU (lebih lambat)…');
    // Mode CPU: model "full" hanya dipakai di mode akurasi tinggi (jauh lebih lambat).
    const model = hq ? MODEL.full : MODEL.lite;
    const near = await make('CPU', model, teamSize * 2 + 1);
    const far: PoseLandmarker[] = [];
    for (let i = 0; i < farTiles; i++) far.push(await make('CPU', model));
    return { near, far, hq, delegate: 'CPU', close: () => [near, ...far].forEach((x) => x.close()) };
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
    this.motionW = engine.hq ? 480 : 320;
    this.motionH = Math.round(this.motionW / cal.aspect);
    this.small.width = this.motionW;
    this.small.height = this.motionH;
  }

  reset() {
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
    const ctx = this.crop.getContext('2d', { willReadFrequently: false })!;
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
      });
    }
    return out;
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
    const g = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    const [p1, p2] = this.prev;
    // Gerak kamera frame ini → frame sebelumnya (piksel), lalu dijumlahkan ke kumulatif.
    let shift: Shift = { dx: 0, dy: 0 };
    if (p1) {
      const m = estimateMotion(g, p1, W, H);
      if (m) {
        const [a, b, tx, ty] = m.cam;
        this.cam = camCompose(this.cam, [a, b, tx / H, ty / H]);
        // Geser rata-rata di tengah frame (untuk selisih frame; putaran kecil diabaikan).
        const cx = W / 2;
        const cy = H / 2;
        shift = { dx: Math.round(a * cx - b * cy + tx - cx), dy: Math.round(b * cx + a * cy + ty - cy) };
      } else this.camFails++;
    }
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
      if (n >= 2 && n <= maxA && bw <= maxS && bh <= maxS) blobs.push({ x: sx / n / W, y: sy / n / H, area: n / (k * k), contrast: (lum - bg) / n });
    }
    // Serpihan di dalam badan pemain (baju, kaki, tangan) bukan kok/bola. Kok yang menempel di raket
    // biasanya di luar kotak badan, jadi tetap tersimpan.
    const free = blobs.filter(
      (b) => !poses.some((p) => b.x > p.box.x + p.box.w * 0.1 && b.x < p.box.x + p.box.w * 0.9 && b.y > p.box.y + p.box.h * 0.1 && b.y < p.box.y + p.box.h),
    );
    // Masih terlalu banyak = frame berisik (kamera goyang / kilau lampu) → tidak dipakai.
    return free.length > 30 ? [] : free;
  }
}
