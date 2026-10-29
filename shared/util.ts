export const uid = (n = 10): string => {
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) s += chars[b % chars.length];
  return s;
};

/** 08xx, +628xx, 628xx → 628xx. Spasi & tanda hubung diabaikan. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return d;
}

export const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function maskPhone(p: string): string {
  const d = normalizePhone(p);
  if (d.length < 6) return d;
  return `0${d.slice(2, 5)}••••${d.slice(-3)}`;
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const TZ = 'Asia/Jakarta';

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso)).replace(':', '.');
}

export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso));
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
