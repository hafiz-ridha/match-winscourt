/**
 * Model AI analisis reli disajikan dari server sendiri (bukan CDN luar):
 * diunduh sekali dari Google (MediaPipe, lisensi Apache-2.0) lalu disimpan di data/models,
 * berikutnya langsung dari disk dengan cache panjang.
 */
import express from 'express';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS: Record<string, string> = {
  'pose_landmarker_full.task': `${BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  'pose_landmarker_lite.task': `${BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};
const dir = join(dirname(resolve(process.env.DB_FILE ?? 'data/match.db')), 'models');
const pending = new Map<string, Promise<void>>();

async function ensure(name: string) {
  const file = join(dir, name);
  if (existsSync(file)) return file;
  let p = pending.get(name);
  if (!p) {
    p = (async () => {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      const res = await fetch(MODELS[name]);
      if (!res.ok || !res.body) throw new Error(`Gagal mengunduh model (${res.status})`);
      try {
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
      console.log(`[models] ${name} tersimpan di ${dir}`);
    })().finally(() => pending.delete(name));
    pending.set(name, p);
  }
  await p;
  return file;
}

export const modelsRouter = express.Router();

modelsRouter.get('/:name', async (req, res) => {
  const name = req.params.name;
  if (!MODELS[name]) return void res.status(404).type('text/plain').send('Not found');
  try {
    const file = await ensure(name);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('application/octet-stream').sendFile(file);
  } catch (e) {
    console.error('[models]', e);
    res.status(502).type('text/plain').send('Model belum bisa diunduh server. Coba lagi sebentar.');
  }
});
