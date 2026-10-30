/**
 * Mesin analisis di HP (tanpa server, video tidak diunggah):
 *  - Pemain: MediaPipe Pose Landmarker (GPU/WebGL bila ada), dijalankan terpisah untuk sisi dekat
 *    & sisi jauh lapangan supaya pemain yang jauh tetap cukup besar untuk dikenali.
 *  - Kok/bola: deteksi benda kecil yang bergerak (selisih 3 frame) → kandidat untuk pelacak lintasan.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { sideRegion, type Blob, type Calib, type FrameObs, type PoseObs } from './core.ts';

const MP_VERSION = '1.1.1';
// Disajikan dari domain sendiri (lihat vite.config.ts & server/models.ts).
const WASM = `/mediapipe/${MP_VERSION}`;
const MODEL = {
  full: '/models/pose_landmarker_full.task',
  lite: '/models/pose_landmarker_lite.task',
};

export interface Engine {
  near: PoseLandmarker;
  far: PoseLandmarker;
  delegate: 'GPU' | 'CPU';
  close(): void;
}

export async function loadEngine(teamSize: 1 | 2, onStatus?: (s: string) => void): Promise<Engine> {
  onStatus?.('Memuat mesin AI…');
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = async (delegate: 'GPU' | 'CPU', model: string) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numPoses: teamSize + 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  onStatus?.('Mengunduh model pelacak pemain (sekali saja)…');
  try {
    const near = await make('GPU', MODEL.full);
    const far = await make('GPU', MODEL.full);
    return { near, far, delegate: 'GPU', close: () => (near.close(), far.close()) };
  } catch {
    onStatus?.('GPU tidak tersedia, memakai mode CPU (lebih lambat)…');
    const near = await make('CPU', MODEL.lite);
    const far = await make('CPU', MODEL.lite);
    return { near, far, delegate: 'CPU', close: () => (near.close(), far.close()) };
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

const MOTION_W = 320;

export class FrameProcessor {
  private crop = document.createElement('canvas');
  private small = document.createElement('canvas');
  private prev: Uint8ClampedArray[] = [];
  private regions: { near: ReturnType<typeof sideRegion>; far: ReturnType<typeof sideRegion> };
  private ts = 0;
  private motionH: number;

  private engine: Engine;
  private video: HTMLVideoElement;

  constructor(engine: Engine, video: HTMLVideoElement, cal: Calib) {
    this.engine = engine;
    this.video = video;
    this.regions = { near: sideRegion(cal, 'near'), far: sideRegion(cal, 'far') };
    this.motionH = Math.round(MOTION_W / cal.aspect);
    this.small.width = MOTION_W;
    this.small.height = this.motionH;
  }

  reset() {
    this.prev = [];
  }

  /** Proses frame video saat ini. */
  process(t: number): FrameObs {
    const poses = [...this.poseIn('near'), ...this.poseIn('far')];
    const blobs = this.motion();
    return { t, poses, blobs };
  }

  private poseIn(side: 'near' | 'far'): PoseObs[] {
    const r = this.regions[side];
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
    const lm = side === 'near' ? this.engine.near : this.engine.far;
    let res;
    try {
      res = lm.detectForVideo(this.crop, this.ts);
    } catch {
      return [];
    }
    const map = (p: { x: number; y: number }) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h });
    return (res.landmarks ?? []).map((l) => {
      const pts = l.map(map);
      const vis = l.map((p) => p.visibility ?? 1);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const footIdx = [27, 28, 29, 30, 31, 32].filter((i) => vis[i] > 0.2);
      const fy = footIdx.length ? Math.max(...footIdx.map((i) => pts[i].y)) : Math.max(...ys);
      const fx = footIdx.length ? footIdx.reduce((s, i) => s + pts[i].x, 0) / footIdx.length : (pts[23].x + pts[24].x) / 2;
      const score = vis.slice(11, 29).reduce((a, b) => a + b, 0) / 18;
      return {
        foot: { x: fx, y: fy },
        box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
        wristL: pts[15],
        wristR: pts[16],
        shoulderL: pts[11],
        shoulderR: pts[12],
        nose: pts[0],
        score,
      };
    });
  }

  /** Kandidat kok/bola: piksel yang berbeda dari 2 frame sebelumnya, dikelompokkan jadi blob kecil. */
  private motion(): Blob[] {
    const W = MOTION_W;
    const H = this.motionH;
    const ctx = this.small.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.video, 0, 0, W, H);
    const rgba = ctx.getImageData(0, 0, W, H).data;
    const g = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    const [p1, p2] = this.prev;
    this.prev = [g, p1].filter(Boolean) as Uint8ClampedArray[];
    if (!p1 || !p2) return [];
    const TH = 22;
    const mask = new Uint8Array(W * H);
    let on = 0;
    for (let j = 0; j < g.length; j++) {
      if (Math.abs(g[j] - p1[j]) > TH && Math.abs(g[j] - p2[j]) > TH) {
        mask[j] = 1;
        on++;
      }
    }
    // Kamera goyang / ganti pencahayaan → abaikan frame.
    if (on > g.length * 0.06) return [];
    const blobs: Blob[] = [];
    const stack: number[] = [];
    for (let j = 0; j < mask.length; j++) {
      if (mask[j] !== 1) continue;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let minX = W;
      let maxX = 0;
      let minY = H;
      let maxY = 0;
      stack.push(j);
      mask[j] = 2;
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % W;
        const y = (k - x) / W;
        n++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[k - 1] === 1) (mask[k - 1] = 2), stack.push(k - 1);
        if (x < W - 1 && mask[k + 1] === 1) (mask[k + 1] = 2), stack.push(k + 1);
        if (y > 0 && mask[k - W] === 1) (mask[k - W] = 2), stack.push(k - W);
        if (y < H - 1 && mask[k + W] === 1) (mask[k + W] = 2), stack.push(k + W);
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // Kok/bola: kecil (bisa memanjang karena blur gerak), bukan potongan badan.
      if (n >= 2 && n <= 90 && bw <= 22 && bh <= 22) blobs.push({ x: sx / n / W, y: sy / n / H, area: n });
    }
    return blobs.length > 40 ? [] : blobs;
  }
}
