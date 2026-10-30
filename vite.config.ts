import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const apiPort = Number(process.env.PORT ?? 8787);

/**
 * Mesin AI analisis reli (WASM MediaPipe) disajikan dari domain sendiri di /mediapipe/<versi>/,
 * bukan dari CDN luar — lebih andal di jaringan seluler & ikut cache Cloudflare.
 */
const MP_VERSION = '1.1.1';
const MP_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
const mpSrc = resolve('node_modules/@mediapipe/tasks-vision/wasm');
function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use(`/mediapipe/${MP_VERSION}`, (req, res, next) => {
        const f = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!MP_FILES.includes(f)) return next();
        res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(mpSrc, f)).pipe(res);
      });
    },
    writeBundle(opts) {
      const out = join(opts.dir ?? 'dist', 'mediapipe', MP_VERSION);
      mkdirSync(out, { recursive: true });
      for (const f of MP_FILES) if (existsSync(join(mpSrc, f))) copyFileSync(join(mpSrc, f), join(out, f));
    },
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/models': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  // Target lebih rendah agar iPhone dengan iOS lama (Safari 13+) tetap bisa menjalankan aplikasi.
  build: { outDir: 'dist', sourcemap: false, target: ['safari13', 'chrome80', 'firefox78', 'edge88'] },
});
