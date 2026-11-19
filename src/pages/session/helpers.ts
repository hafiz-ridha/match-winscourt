import { formatInfo } from '../../../shared/formats.ts';
import { matchScore, playerStandings, teamStandings } from '../../../shared/standings.ts';
import { drawMedal } from '../../components/Medal.tsx';
import { championText, podiumOf } from './podium.ts';
import { scoreSummary } from '../../../shared/scoring.ts';
import type { Match, Session } from '../../../shared/types.ts';
import { fmtDate, fmtTime } from '../../../shared/util.ts';
import type { Role } from '../../api.ts';

export interface Ctx {
  s: Session;
  role: Role;
  playerId: string | null;
  act: (body: Record<string, unknown>) => Promise<Session>;
  isHost: boolean;
  canScore: boolean;
}

export const nameOf = (s: Session, id: string) => s.players.find((p) => p.id === id)?.name ?? '?';
export const teamNames = (s: Session, ids: string[]) => ids.map((id) => nameOf(s, id)).join(' & ');
export const courtName = (s: Session, i: number) => s.courtNames[i] ?? (s.sport === 'padel' ? 'Padel' : `Line ${i + 1}`);
export const shortCourt = (s: Session, i: number) => (s.sport === 'padel' ? 'Padel' : `L${(s.courtNames[i] ?? '').replace(/\D/g, '') || i + 1}`);
export const isMine = (m: Match, pid: string | null) => !!pid && (m.a.includes(pid) || m.b.includes(pid));

export function sessionUrl(s: Session) {
  return `${location.origin}/s/${s.slug}`;
}
export function refereeUrl(s: Session) {
  return `${location.origin}/s/${s.slug}/wasit?key=${s.refKey}`;
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const csvCell = (v: unknown) => {
  const t = String(v ?? '');
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function exportCsv(s: Session) {
  const rows: unknown[][] = [['Ronde', 'Lapangan', 'Babak', 'Tim A', 'Tim B', 'Skor', 'Status']];
  for (const r of s.rounds)
    for (const m of r.matches) {
      const sc = matchScore(s, m);
      rows.push([r.n, courtName(s, m.court), m.stage ?? '', teamNames(s, m.a), teamNames(s, m.b), scoreSummary(sc, s.rules), m.status === 'done' ? 'Selesai' : m.status === 'live' ? 'Berjalan' : 'Terjadwal']);
    }
  rows.push([]);
  rows.push(['Peringkat', 'Nama', 'Main', 'Menang', 'Seri', 'Kalah', 'Poin', 'Bonus', '+M', 'Total']);
  playerStandings(s).forEach((x, i) => rows.push([i + 1, x.name, x.played, x.won, x.draw, x.lost, x.pf, x.bonus, x.comp, x.total]));
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n');
  download(`${s.name.replace(/[^\w-]+/g, '_')}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/** Gambar hasil sesi 1080×1350 (WhatsApp/Instagram): podium juara 1–3 + peringkat berikutnya. */
export async function shareImage(s: Session) {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  const P = 72;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const display = '"Plus Jakarta Sans", Inter, sans-serif';
  const F = (w: number, px: number, fam = display) => `${w} ${px}px ${fam}`;
  const INK = '#0E1714';
  const LIME = '#C6FF3D';
  const clip = (t: string, max: number) => {
    if (g.measureText(t).width <= max) return t;
    let x = t;
    while (x.length > 1 && g.measureText(x + '…').width > max) x = x.slice(0, -1);
    return x + '…';
  };

  // Latar gelap Wins Court + cahaya lime di atas podium.
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 520, 40, W / 2, 520, 620);
  glow.addColorStop(0, 'rgba(198,255,61,0.22)');
  glow.addColorStop(1, 'rgba(198,255,61,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Kepala
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.font = F(800, 46);
  g.fillStyle = '#fff';
  g.fillText('Wins ', P, 112);
  g.fillStyle = LIME;
  g.fillText('Court', P + g.measureText('Wins ').width, 112);
  g.font = F(800, 22);
  const lab = 'HASIL SESI';
  const lw = g.measureText(lab).width + 40;
  g.fillStyle = LIME;
  roundRect(g, W - P - lw, 78, lw, 46, 23);
  g.fill();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.fillText(lab, W - P - lw / 2, 109);
  g.textAlign = 'left';
  g.font = F(800, 54);
  g.fillStyle = '#fff';
  g.fillText(clip(s.name, W - P * 2), P, 210);
  g.font = F(500, 26, 'Inter, sans-serif');
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillText(clip(`${s.sport === 'padel' ? 'Padel' : 'Badminton'} · ${formatInfo(s.format).name} · ${fmtDate(s.start)} ${fmtTime(s.start)}`, W - P * 2), P, 256);

  // Podium 2 – 1 – 3
  const pod = podiumOf(s);
  const base = 860;
  const colW = 280;
  const gap = 24;
  const x0 = (W - colW * 3 - gap * 2) / 2;
  const STEP: Record<1 | 2 | 3, { h: number; col: number; top: string; face: string }> = {
    1: { h: 300, col: 1, top: '#FFE58A', face: '#E0B02A' },
    2: { h: 220, col: 0, top: '#F4F6F8', face: '#AEB7BF' },
    3: { h: 170, col: 2, top: '#F6C9A0', face: '#C07A42' },
  };
  g.textAlign = 'center';
  g.font = F(600, 24, 'Inter, sans-serif');
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText(pod.club ? (pod.club.winner ? `CLUB VS CLUB · KLUB ${pod.club.winner} MENANG (${pod.club.a}–${pod.club.b})` : `CLUB VS CLUB · SERI ${pod.club.a}–${pod.club.b}`) : 'JUARA SESI', W / 2, 330);
  for (const e of pod.list) {
    const st = STEP[e.rank];
    const x = x0 + st.col * (colW + gap);
    const top = base - st.h;
    // Tangga: permukaan atas metalik, sisi depan lebih gelap.
    const face = g.createLinearGradient(0, top, 0, base);
    face.addColorStop(0, st.face);
    face.addColorStop(1, 'rgba(255,255,255,0.04)');
    g.fillStyle = face;
    roundRect(g, x, top, colW, st.h, 22);
    g.fill();
    g.fillStyle = st.top;
    roundRect(g, x, top, colW, 16, 8);
    g.fill();
    g.fillStyle = 'rgba(14,23,20,0.28)';
    g.font = F(800, e.rank === 1 ? 150 : 120);
    g.fillText(String(e.rank), x + colW / 2, top + (e.rank === 1 ? 190 : 150));
    // Medali, nama, keterangan di atas tangga.
    const names = e.names.length > 1 ? e.names : e.names[0].includes(' & ') ? e.names[0].split(' & ') : e.names;
    const two = names.length > 1;
    const medal = e.rank === 1 ? 104 : 86;
    drawMedal(g, e.rank, x + colW / 2, top - (two ? 172 : 136) - medal / 2 + 40, medal);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = F(800, e.rank === 1 ? 34 : 30);
    if (two) {
      g.fillText(clip(names[0] + ' &', colW + 10), x + colW / 2, top - 94);
      g.fillText(clip(names[1], colW + 10), x + colW / 2, top - 56);
    } else g.fillText(clip(names[0], colW + 10), x + colW / 2, top - 56);
    g.font = F(600, 21, 'Inter, sans-serif');
    g.fillStyle = e.rank === 1 ? LIME : 'rgba(255,255,255,0.65)';
    g.fillText(clip(e.stat, colW), x + colW / 2, top - 22);
  }
  g.textAlign = 'left';

  // Peringkat berikutnya (4–7).
  // Sama jenisnya dengan podium (tim tetap → tim, selain itu pemain); turnamen tidak punya peringkat 4+.
  const bracket = formatInfo(s.format).bracket && pod.list[0]?.stat === 'Juara turnamen';
  const rest = (pod.kind === 'team' ? teamStandings(s) : playerStandings(s)).filter((x) => x.played > 0);
  const startAt = 3;
  const rows = bracket ? [] : rest.slice(startAt, startAt + 4);
  let y = 930;
  if (rows.length) {
    g.font = F(700, 22, 'Inter, sans-serif');
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText('PERINGKAT BERIKUTNYA', P, y);
    y += 24;
    rows.forEach((x, i) => {
      const ry = y + i * 62;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
      roundRect(g, P - 8, ry, W - P * 2 + 16, 54, 16);
      g.fill();
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = F(800, 24);
      g.fillText(String(startAt + i + 1), P + 14, ry + 28);
      g.fillStyle = '#fff';
      g.font = F(700, 28);
      g.fillText(clip(x.name, W - P * 2 - 260), P + 64, ry + 28);
      g.textAlign = 'right';
      g.font = F(800, 28);
      g.fillText(s.settings.sortBy === 'wins' ? `${x.won} menang` : `${x.total} poin`, W - P - 14, ry + 28);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    });
  }

  // Kaki
  g.textAlign = 'center';
  g.font = F(800, 34);
  g.fillStyle = LIME;
  g.fillText('match.wins-court.com', W / 2, H - 76);
  g.font = F(500, 21, 'Inter, sans-serif');
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText('Matchmaking & skor badminton · padel — Wins Court', W / 2, H - 42);

  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const file = new File([blob], 'hasil-sesi.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${s.name} · Juara: ${championText(pod)}` });
      return;
    } catch {
      /* dibatalkan, lanjut unduh */
    }
  }
  download('hasil-sesi.png', blob);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
