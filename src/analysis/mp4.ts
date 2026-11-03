/**
 * Ekspor MP4 standar yang diterima Instagram / TikTok / WhatsApp:
 *  - Video H.264 (High → Main → Baseline, mana yang didukung), 30 fps KONSTAN, keyframe tiap 2 detik
 *  - Audio AAC-LC dari video asli (bila browser bisa meng-encode AAC; selain itu tanpa suara)
 *  - Index (moov) di depan file ("faststart"), bukan MP4 terfragmentasi
 * Frame digambar satu per satu (bukan rekaman real-time), jadi hasil tidak terpotong walau HP lambat.
 */
import { drawExportFrame, frameAt, type Result } from './render.ts';
import { seek } from './vision.ts';

const FPS = 30;
const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f'];

export interface Mp4Info {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audio: boolean;
  duration: number;
}

/** Codec H.264 pertama yang bisa di-encode browser ini, atau null (fallback ke MediaRecorder). */
export async function mp4Codec(width: number, height: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of VIDEO_CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 6_000_000, framerate: FPS });
      if (r.supported) return codec;
    } catch {
      /* coba berikutnya */
    }
  }
  return null;
}

/** Audio video sumber (sudah di-resample 48 kHz) untuk rentang [from, to] detik, atau null. */
async function sourceAudio(src: string, from: number, to: number): Promise<{ data: Float32Array[]; sampleRate: number } | null> {
  try {
    const buf = await (await fetch(src)).arrayBuffer();
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ab = await new Ctx(2, 48000, 48000).decodeAudioData(buf);
    const sr = ab.sampleRate;
    const a = Math.max(0, Math.floor(from * sr));
    const b = Math.min(ab.length, Math.ceil(to * sr));
    if (b - a < sr * 0.2) return null;
    const ch0 = ab.getChannelData(0).slice(a, b);
    const ch1 = ab.numberOfChannels > 1 ? ab.getChannelData(1).slice(a, b) : ch0.slice();
    return { data: [ch0, ch1], sampleRate: sr };
  } catch {
    return null; // video tanpa suara / format audio tidak didukung
  }
}

export async function exportMp4(opts: {
  src: string;
  r: Result;
  layout: 'portrait' | 'landscape';
  showKcal: boolean;
  end: number;
  codec: string;
  onProgress: (p: number) => void;
  signal: { cancelled: boolean };
}): Promise<{ blob: Blob; mime: string; info: Mp4Info }> {
  const { r, layout } = opts;
  const W = layout === 'portrait' ? 720 : 1280;
  const H = layout === 'portrait' ? 1280 : 720;
  const t0 = r.start;
  const dur = Math.max(0.5, opts.end - t0);
  const total = Math.max(1, Math.round(dur * FPS));

  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  // Audio: AAC hanya bila browser mendukung encoder-nya.
  const pcm = await sourceAudio(opts.src, t0, t0 + total / FPS);
  let aac = false;
  if (pcm && typeof AudioEncoder !== 'undefined') {
    try {
      aac = !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: pcm.sampleRate, numberOfChannels: 2, bitrate: 128_000 })).supported;
    } catch {
      aac = false;
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: aac && pcm ? { codec: 'aac', numberOfChannels: 2, sampleRate: pcm.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure: Error | null = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
  });
  venc.configure({ codec: opts.codec, width: W, height: H, bitrate: layout === 'portrait' ? 5_000_000 : 6_000_000, framerate: FPS, avc: { format: 'avc' } });

  // Video sumber dipasang di halaman (tak terlihat) supaya browser HP mau mendekode frame.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(holder);
  const video = document.createElement('video');
  holder.appendChild(video);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = opts.src;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  try {
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('Video tidak bisa dibaca ulang'));
      video.load();
    });

    const usPerFrame = 1e6 / FPS;
    for (let i = 0; i < total; i++) {
      if (opts.signal.cancelled) throw new Error('Dibatalkan');
      if (failure) throw failure;
      const t = t0 + i / FPS;
      await seek(video, Math.min(t, opts.end - 0.01));
      drawExportFrame(ctx, video, r, frameAt(r, t), layout, opts.showKcal);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * usPerFrame), duration: Math.round(usPerFrame) });
      venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await new Promise((res) => setTimeout(res, 4));
      if (i % 3 === 0) opts.onProgress((i + 1) / total);
    }
    await venc.flush();
    if (failure) throw failure;

    if (aac && pcm) {
      let aerr: Error | null = null;
      const aenc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => (aerr = e instanceof Error ? e : new Error(String(e))),
      });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: pcm.sampleRate, numberOfChannels: 2, bitrate: 128_000 });
      const len = Math.min(pcm.data[0].length, Math.round((total / FPS) * pcm.sampleRate));
      const step = 4096;
      for (let k = 0; k < len; k += step) {
        const n = Math.min(step, len - k);
        const planar = new Float32Array(n * 2);
        planar.set(pcm.data[0].subarray(k, k + n), 0);
        planar.set(pcm.data[1].subarray(k, k + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: pcm.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((k / pcm.sampleRate) * 1e6), data: planar });
        aenc.encode(ad);
        ad.close();
      }
      await aenc.flush();
      aenc.close();
      if (aerr) throw aerr;
    }

    muxer.finalize();
    opts.onProgress(1);
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      mime: 'video/mp4',
      info: { width: W, height: H, fps: FPS, videoCodec: opts.codec, audio: aac && !!pcm, duration: total / FPS },
    };
  } finally {
    try {
      venc.close();
    } catch {
      /* sudah ditutup */
    }
    holder.remove();
    video.removeAttribute('src');
    video.load();
  }
}
