import { formatInfo } from '../../../shared/formats.ts';
import { matchScore, playerStandings } from '../../../shared/standings.ts';
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

/** Gambar ringkasan 1080×1350 untuk WhatsApp/Instagram. */
export async function shareImage(s: Session, champion: string) {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const display = '"Plus Jakarta Sans", Inter, sans-serif';
  g.fillStyle = '#FAFAF7';
  g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700);
  grad.addColorStop(0, 'rgba(198,255,61,0.35)');
  grad.addColorStop(1, 'rgba(250,250,247,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, 700);
  // garis lapangan
  g.strokeStyle = 'rgba(14,23,20,0.12)';
  g.lineWidth = 3;
  g.strokeRect(80, 80, W - 160, 360);
  g.beginPath();
  g.moveTo(W / 2, 70);
  g.lineTo(W / 2, 450);
  g.strokeStyle = '#3F6B0F';
  g.stroke();
  g.fillStyle = '#0E1714';
  g.font = `800 34px ${display}`;
  g.fillText('match.wins-court.com', 80, 530);
  g.font = `500 30px Inter, sans-serif`;
  g.fillStyle = '#5D6661';
  g.fillText(`${s.sport === 'padel' ? 'Padel' : 'Badminton'} · ${formatInfo(s.format).name} · ${fmtDate(s.start)} ${fmtTime(s.start)}`, 80, 580);
  g.fillStyle = '#0E1714';
  g.font = `800 64px ${display}`;
  g.fillText(s.name.slice(0, 26), 80, 660);
  // kartu juara
  g.fillStyle = '#C6FF3D';
  roundRect(g, 80, 700, W - 160, 170, 36);
  g.fill();
  g.fillStyle = '#0E1714';
  g.font = `600 28px Inter, sans-serif`;
  g.fillText('JUARA SESI', 120, 760);
  g.font = `800 60px ${display}`;
  g.fillText(champion.slice(0, 28), 120, 835);
  // 5 besar
  const st = playerStandings(s).slice(0, 5);
  g.font = `600 28px Inter, sans-serif`;
  g.fillStyle = '#5D6661';
  g.fillText('PERINGKAT', 80, 940);
  st.forEach((x, i) => {
    const y = 1000 + i * 60;
    g.fillStyle = i === 0 ? '#3F6B0F' : '#0E1714';
    g.font = `800 36px ${display}`;
    g.fillText(String(i + 1), 80, y);
    g.font = `600 36px Inter, sans-serif`;
    g.fillStyle = '#0E1714';
    g.fillText(x.name.slice(0, 24), 140, y);
    g.font = `800 36px ${display}`;
    g.textAlign = 'right';
    g.fillText(String(x.total), W - 80, y);
    g.textAlign = 'left';
  });
  g.fillStyle = '#8E948F';
  g.font = `500 26px Inter, sans-serif`;
  g.fillText('match.wins-court.com', 80, H - 60);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const file = new File([blob], 'hasil-sesi.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: s.name });
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
