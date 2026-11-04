/** Bunyi pukulan dari audio video (di HP, tanpa unggah). */
import { detectOnsets } from './core.ts';

const SR = 22050;

/**
 * Waktu bunyi pukulan (detik video) di rentang [from, to].
 * null = video tanpa suara atau audio tidak bisa dibaca browser.
 */
export async function audioOnsets(src: string, from: number, to: number): Promise<number[] | null> {
  try {
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const buf = await (await fetch(src)).arrayBuffer();
    const ab = await new Ctx(1, SR, SR).decodeAudioData(buf);
    const sr = ab.sampleRate;
    const a = Math.max(0, Math.floor(from * sr));
    const b = Math.min(ab.length, Math.ceil(to * sr));
    if (b - a < sr * 0.5) return null;
    // Gabung kanal jadi mono.
    const x = new Float32Array(b - a);
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < x.length; i++) x[i] += d[a + i] / ab.numberOfChannels;
    }
    // Rekaman tanpa suara (semua nol) → sama dengan tidak ada audio.
    let peak = 0;
    for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
    if (peak < 1e-4) return null;
    return detectOnsets(x, sr).map((t) => from + t);
  } catch {
    return null;
  }
}
