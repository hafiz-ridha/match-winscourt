/** Medali peringkat 1–3 (emas, perak, perunggu) dengan pita. */
export const MEDAL_COLORS: Record<1 | 2 | 3, { light: string; mid: string; dark: string; ribbon: [string, string] }> = {
  1: { light: '#FFE58A', mid: '#F2C230', dark: '#B8860B', ribbon: ['#1F7A57', '#2BC58A'] },
  2: { light: '#F4F6F8', mid: '#C9D0D6', dark: '#8A949C', ribbon: ['#2563EB', '#60A5FA'] },
  3: { light: '#F6C9A0', mid: '#D08A4E', dark: '#8C5A2B', ribbon: ['#B91C1C', '#F87171'] },
};

export function Medal({ rank, size = 26 }: { rank: 1 | 2 | 3; size?: number }) {
  const c = MEDAL_COLORS[rank];
  const id = `medal-${rank}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={`Peringkat ${rank}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={id} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor={c.light} />
          <stop offset="55%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.dark} />
        </radialGradient>
      </defs>
      {/* pita */}
      <path d="M9 1h6l3 10-6 3z" fill={c.ribbon[0]} />
      <path d="M23 1h-6l-3 10 6 3z" fill={c.ribbon[1]} />
      {/* koin */}
      <circle cx="16" cy="20" r="10.5" fill={`url(#${id})`} stroke={c.dark} strokeWidth="1.2" />
      <circle cx="16" cy="20" r="7.6" fill="none" stroke={c.light} strokeOpacity="0.7" strokeWidth="1" />
      <text x="16" y="24.2" textAnchor="middle" fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="800" fontSize="11.5" fill={rank === 2 ? '#3d454b' : '#4a3200'}>
        {rank}
      </text>
    </svg>
  );
}

/** Medali yang sama, digambar di kanvas (untuk gambar peringkat yang dibagikan). */
export function drawMedal(ctx: CanvasRenderingContext2D, rank: 1 | 2 | 3, x: number, y: number, size: number) {
  const c = MEDAL_COLORS[rank];
  const s = size / 32;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = c.ribbon[0];
  ctx.beginPath();
  ctx.moveTo(9, 1);
  ctx.lineTo(15, 1);
  ctx.lineTo(18, 11);
  ctx.lineTo(12, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.ribbon[1];
  ctx.beginPath();
  ctx.moveTo(23, 1);
  ctx.lineTo(17, 1);
  ctx.lineTo(14, 11);
  ctx.lineTo(20, 14);
  ctx.closePath();
  ctx.fill();
  const g = ctx.createRadialGradient(12, 16.5, 0, 16, 20, 11);
  g.addColorStop(0, c.light);
  g.addColorStop(0.55, c.mid);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(16, 20, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = c.light;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(16, 20, 7.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = rank === 2 ? '#3d454b' : '#4a3200';
  ctx.font = `800 11.5px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(rank), 16, 24.2);
  ctx.restore();
}
