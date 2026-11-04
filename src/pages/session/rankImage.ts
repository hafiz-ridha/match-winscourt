/** Gambar peringkat (PNG) bergaya Wins Court untuk dibagikan ke WhatsApp / Instagram. */
import { formatInfo } from '../../../shared/formats.ts';
import type { Session, Standing } from '../../../shared/types.ts';
import { fmtDate, fmtTime } from '../../../shared/util.ts';
import { drawMedal } from '../../components/Medal.tsx';

const INK = '#0E1714';
const LIME = '#C6FF3D';
const F = (w: number, s: number) => `${w} ${s}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
const MAX_ROWS = 24;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export function drawRankImage(s: Session, list: Standing[], title: string): HTMLCanvasElement {
  const W = 1080;
  const P = 72;
  const rows = list.slice(0, MAX_ROWS);
  const more = list.length - rows.length;
  const RH = 84;
  const headH = 330;
  const tableTop = headH + 70;
  const H = Math.max(1350, tableTop + rows.length * RH + (more > 0 ? 60 : 0) + 170);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // Latar gelap Wins Court + cahaya lime lembut di atas.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, -80, 40, W / 2, -80, W);
  g.addColorStop(0, 'rgba(198,255,61,0.22)');
  g.addColorStop(1, 'rgba(198,255,61,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.6);

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = F(800, 52);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Wins ', P, 120);
  ctx.fillStyle = LIME;
  ctx.fillText('Court', P + ctx.measureText('Wins ').width, 120);
  // label
  ctx.font = F(800, 24);
  const lab = 'PERINGKAT';
  const lw = ctx.measureText(lab).width + 44;
  ctx.fillStyle = LIME;
  roundRect(ctx, W - P - lw, 82, lw, 50, 25);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.fillText(lab, W - P - lw / 2, 116);
  // sesi
  ctx.textAlign = 'left';
  ctx.font = F(800, 46);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(clip(ctx, s.name, W - P * 2), P, 210);
  ctx.font = F(600, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  const sub = [
    s.sport === 'padel' ? 'Padel' : 'Badminton',
    formatInfo(s.format).name,
    `${fmtDate(s.start)} · ${fmtTime(s.start)}–${fmtTime(s.end)}`,
    s.courtNames.join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(clip(ctx, sub, W - P * 2), P, 256);
  if (title) {
    ctx.font = F(700, 24);
    ctx.fillStyle = LIME;
    ctx.fillText(title.toUpperCase(), P, 300);
  }

  // Kepala tabel
  const col = { rank: P + 40, name: P + 110, m: 640, msk: 760, total: W - P - 20 };
  ctx.font = F(700, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'center';
  ctx.fillText('#', col.rank, tableTop);
  ctx.fillText('M', col.m, tableTop);
  ctx.fillText('M-S-K', col.msk, tableTop);
  ctx.textAlign = 'right';
  ctx.fillText(s.settings.sortBy === 'wins' ? 'MENANG' : 'TOTAL', col.total, tableTop);
  ctx.textAlign = 'left';
  ctx.fillText('NAMA', col.name, tableTop);

  rows.forEach((x, i) => {
    const y = tableTop + 22 + i * RH;
    const cy = y + RH / 2;
    const rank = i + 1;
    const medal = rank <= 3 && x.played > 0;
    // Baris: 3 besar disorot.
    ctx.fillStyle = medal ? 'rgba(198,255,61,0.09)' : i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
    roundRect(ctx, P - 12, y + 6, W - P * 2 + 24, RH - 12, 22);
    ctx.fill();
    if (medal) drawMedal(ctx, rank as 1 | 2 | 3, col.rank, cy, 62);
    else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(col.rank, cy, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = F(800, 22);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(rank), col.rank, cy + 1);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = F(medal ? 800 : 700, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(clip(ctx, x.name, col.m - col.name - 50), col.name, cy + 1);
    ctx.textAlign = 'center';
    ctx.font = F(600, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(String(x.played), col.m, cy + 1);
    ctx.fillText(`${x.won}-${x.draw}-${x.lost}`, col.msk, cy + 1);
    ctx.textAlign = 'right';
    ctx.font = F(800, 36);
    ctx.fillStyle = medal ? LIME : '#ffffff';
    ctx.fillText(String(s.settings.sortBy === 'wins' ? x.won : x.total), col.total, cy + 1);
    ctx.textBaseline = 'alphabetic';
  });
  if (more > 0) {
    ctx.font = F(600, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText(`+${more} pemain lainnya`, W / 2, tableTop + 22 + rows.length * RH + 40);
  }

  // Footer
  ctx.textAlign = 'center';
  ctx.font = F(800, 38);
  ctx.fillStyle = LIME;
  ctx.fillText('match.wins-court.com', W / 2, H - 80);
  ctx.font = F(600, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Matchmaking & skor badminton · padel — Wins Court', W / 2, H - 44);
  return c;
}

export const rankFileName = (s: Session) => `peringkat-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sesi'}.png`;
