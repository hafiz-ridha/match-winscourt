import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  // Target lebih rendah agar iPhone dengan iOS lama (Safari 13+) tetap bisa menjalankan aplikasi.
  build: { outDir: 'dist', sourcemap: false, target: ['safari13', 'chrome80', 'firefox78', 'edge88'] },
});
