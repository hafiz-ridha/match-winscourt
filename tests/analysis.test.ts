import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apply,
  calibMaps,
  detectHits,
  homography,
  kcalFor,
  summarize,
  swapSlots,
  trackPlayers,
  trackShuttle,
  type Calib,
  type FrameObs,
  type PoseObs,
  type Pt,
} from '../src/analysis/core.ts';

const cal: Calib = {
  sport: 'badminton',
  quad: [
    { x: 0.35, y: 0.35 },
    { x: 0.65, y: 0.35 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ],
  aspect: 16 / 9,
};
const { toImage, spec } = calibMaps(cal);
const padelCal: Calib = { ...cal, sport: 'padel' };

test('homografi: 4 sudut terpetakan tepat & bolak-balik konsisten', () => {
  const src = cal.quad;
  const dst = [
    { x: 0, y: 0 },
    { x: 6.1, y: 0 },
    { x: 6.1, y: 13.4 },
    { x: 0, y: 13.4 },
  ];
  const h = homography(src, dst);
  src.forEach((p, i) => {
    const q = apply(h, p);
    assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
  });
  const { toCourt } = calibMaps(cal);
  const mid = toCourt(toImage({ x: 3.05, y: 6.7 }));
  assert.ok(Math.abs(mid.x - 3.05) < 1e-6 && Math.abs(mid.y - 6.7) < 1e-6);
});

/** Pose sintetis untuk pemain berdiri di titik lapangan c; wrist = posisi tangan (gambar). */
function pose(c: Pt, wrist?: Pt, map: (p: Pt) => Pt = toImage): PoseObs {
  const foot = map(c);
  const hgt = 0.12 * (0.5 + foot.y); // pemain jauh tampak lebih kecil
  const box = { x: foot.x - hgt * 0.2, y: foot.y - hgt, w: hgt * 0.4, h: hgt };
  const w = wrist ?? { x: foot.x + hgt * 0.15, y: foot.y - hgt * 0.55 };
  return {
    foot,
    box,
    wristL: { x: foot.x - hgt * 0.15, y: foot.y - hgt * 0.55 },
    wristR: w,
    shoulderL: { x: foot.x - hgt * 0.1, y: foot.y - hgt * 0.8 },
    shoulderR: { x: foot.x + hgt * 0.1, y: foot.y - hgt * 0.8 },
    nose: { x: foot.x, y: foot.y - hgt * 0.92 },
    score: 0.9,
  };
}

/**
 * Reli tunggal sintetis 15 fps: pemain dekat (slot 0) & jauh (slot 1) bergantian memukul tiap 1 detik.
 * Kok bergerak lurus di gambar dari tangan pemukul ke tangan penerima.
 */
function rally(nHits: number, sport: 'badminton' | 'padel' = 'badminton') {
  const map = sport === 'padel' ? calibMaps(padelCal).toImage : toImage;
  const L = sport === 'padel' ? 20 : 13.4;
  const fps = 15;
  const per = 15; // frame per pukulan
  const frames: FrameObs[] = [];
  const cx = sport === 'padel' ? 5 : 3;
  const nearPos = (f: number): Pt => ({ x: cx + Math.sin(f / 9) * 1.2, y: L * 0.82 + Math.cos(f / 13) * 1.0 });
  const farPos = (f: number): Pt => ({ x: cx + Math.cos(f / 11) * 1.2, y: L * 0.19 + Math.sin(f / 7) * 1.0 });
  const hand = (p: PoseObs) => ({ x: p.box.x + p.box.w * 0.9, y: p.box.y + p.box.h * 0.1 });
  const total = nHits * per + 10;
  for (let f = 0; f < total; f++) {
    const near = pose(nearPos(f), undefined, map);
    const far = pose(farPos(f), undefined, map);
    const k = Math.floor(f / per);
    const r = (f % per) / per;
    const from = k % 2 === 0 ? near : far;
    const to = k % 2 === 0 ? far : near;
    const blobs = [];
    if (k < nHits) {
      const a = hand(from);
      const b = hand(to);
      // Lengkung: kok naik dulu (y gambar mengecil) lalu turun.
      let s = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r - Math.sin(Math.PI * r) * 0.12 };
      // Padel: bola memantul di lantai pada 70% lintasan (belokan tajam jauh dari tangan).
      if (sport === 'padel' && r > 0.6 && r < 0.8) s = { x: s.x, y: s.y + (0.7 - Math.abs(r - 0.7)) * 0.15 };
      blobs.push({ x: s.x, y: s.y, area: 6 });
      // Tangan pemukul tepat di kok saat memukul.
      if (f % per === 0) from.wristR = { ...s };
    }
    // Derau: blob acak yang tidak konsisten.
    if (f % 4 === 1) blobs.push({ x: (f * 0.137) % 1, y: 0.05 + ((f * 0.071) % 0.2), area: 30 });
    frames.push({ t: f / fps, poses: [near, far], blobs });
  }
  return { frames, per };
}

test('pelacak pemain: slot dekat/jauh konsisten & jarak masuk akal', () => {
  const { frames } = rally(6);
  const tracks = trackPlayers(frames, cal, 1);
  assert.equal(tracks.length, 2);
  const nearSeen = tracks[0].frames.filter(Boolean).length;
  assert.ok(nearSeen / frames.length > 0.95);
  for (const f of tracks[0].frames) if (f) assert.ok(f.court.y > spec.L / 2, 'slot 0 harus sisi dekat');
  for (const f of tracks[1].frames) if (f) assert.ok(f.court.y < spec.L / 2, 'slot 1 harus sisi jauh');
  const st = summarize(frames, tracks, [], 'badminton', 1, [65, 65]);
  assert.ok(st.players[0].distance > 2 && st.players[0].distance < 40, `jarak ${st.players[0].distance}`);
});

test('pelacak kok & deteksi pukulan: menemukan pukulan bergantian dengan pemukul benar', () => {
  const n = 8;
  const { frames, per } = rally(n);
  const tracks = trackPlayers(frames, cal, 1);
  const shuttle = trackShuttle(frames, tracks, cal.aspect);
  const visible = shuttle.filter(Boolean).length;
  assert.ok(visible > frames.length * 0.6, `kok terlacak ${visible}/${frames.length}`);
  const hits = detectHits(frames, tracks, shuttle, 'badminton', 1);
  // Pukulan pertama (frame 0) tidak punya arah datang; sisanya harus terdeteksi.
  assert.ok(hits.length >= n - 2 && hits.length <= n + 1, `jumlah pukulan ${hits.length}`);
  for (let i = 1; i < hits.length; i++) assert.notEqual(hits[i].player, hits[i - 1].player, 'pukulan harus bergantian sisi');
  for (const h of hits) {
    const k = Math.round(h.frame / per);
    assert.ok(Math.abs(h.frame - k * per) <= 2, `frame pukulan ${h.frame} dekat ${k * per}`);
    assert.equal(h.player, k % 2 === 0 ? 0 : 1, 'pemukul sesuai sisi');
  }
  assert.equal(hits[0].type, 'servis');
});

test('statistik & tukar slot', () => {
  const { frames } = rally(4);
  const tracks = trackPlayers(frames, cal, 1);
  const shuttle = trackShuttle(frames, tracks, cal.aspect);
  const hits = detectHits(frames, tracks, shuttle, 'badminton', 1);
  const before = summarize(frames, tracks, hits, 'badminton', 1, [65, 80]);
  swapSlots(tracks, hits, 0, 1);
  const after = summarize(frames, tracks, hits, 'badminton', 1, [65, 80]);
  assert.equal(after.players[0].hits, before.players[1].hits);
  assert.ok(Math.abs(after.players[0].distance - before.players[1].distance) < 1e-9);
  assert.ok(before.rallies >= 1);
});

test('kalori: naik dengan jarak & berat, 0 bila durasi 0', () => {
  assert.equal(kcalFor(65, 0, 10), 0);
  const a = kcalFor(65, 60, 60);
  assert.ok(a > 5 && a < 9, `kkal ${a}`);
  assert.ok(kcalFor(80, 60, 60) > a);
  assert.ok(kcalFor(65, 60, 120) > a);
});

test('ganda: 4 slot stabil (kiri/kanan tiap sisi) walau urutan deteksi acak', () => {
  const frames: FrameObs[] = [];
  for (let f = 0; f < 90; f++) {
    const ps = [
      pose({ x: 1.5 + Math.sin(f / 10) * 0.4, y: 10.5 }),
      pose({ x: 4.6 - Math.sin(f / 12) * 0.4, y: 11.5 }),
      pose({ x: 1.5, y: 2.5 + Math.sin(f / 8) * 0.5 }),
      pose({ x: 4.6, y: 3 }),
    ];
    // urutan hasil detektor berubah-ubah
    if (f % 2) ps.reverse();
    if (f % 3 === 0) ps.push(ps.shift()!);
    frames.push({ t: f / 15, poses: ps, blobs: [] });
  }
  const tracks = trackPlayers(frames, cal, 2);
  assert.equal(tracks.length, 4);
  const avgX = (i: number) => {
    const xs = tracks[i].frames.filter(Boolean).map((f) => f!.court.x);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  for (const [slot, x] of [
    [0, 1.5],
    [1, 4.6],
    [2, 1.5],
    [3, 4.6],
  ] as const)
    assert.ok(Math.abs(avgX(slot) - x) < 0.3, `slot ${slot} rata-rata x ${avgX(slot)}`);
  for (const t of tracks) for (let i = 1; i < t.frames.length; i++) {
    const a = t.frames[i - 1];
    const b = t.frames[i];
    if (a && b) assert.ok(Math.hypot(a.court.x - b.court.x, a.court.y - b.court.y) < 0.6, 'tidak ada lompatan antar pemain');
  }
});

test('padel: pukulan terdeteksi, pantulan bola di lantai tidak dihitung', () => {
  const n = 8;
  const { frames, per } = rally(n, 'padel');
  const tracks = trackPlayers(frames, padelCal, 1);
  for (const f of tracks[0].frames) if (f) assert.ok(f.court.y > 10, 'slot 0 sisi dekat');
  const shuttle = trackShuttle(frames, tracks, padelCal.aspect);
  const hits = detectHits(frames, tracks, shuttle, 'padel', 1);
  assert.ok(hits.length >= n - 2 && hits.length <= n + 1, `jumlah pukulan ${hits.length}`);
  for (const h of hits) {
    const k = Math.round(h.frame / per);
    assert.ok(Math.abs(h.frame - k * per) <= 2, `frame pukulan ${h.frame} (bukan pantulan)`);
  }
  for (let i = 1; i < hits.length; i++) assert.notEqual(hits[i].player, hits[i - 1].player);
  assert.equal(hits[0].type, 'servis');
  for (const h of hits) assert.ok(['servis', 'smash', 'bandeja', 'volley', 'lob', 'dasar'].includes(h.type), h.type);
  const st = summarize(frames, tracks, hits, 'padel', 1, [70, 70]);
  assert.ok(st.players[0].distance > 2 && st.players[0].distance < 60);
});
