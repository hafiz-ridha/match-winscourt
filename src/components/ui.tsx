import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { levelName } from '../../shared/formats.ts';
import type { Sport } from '../../shared/types.ts';
import { Ball, Shuttle } from './Icons.tsx';

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean; id: number } | null>(null);
  const show = useCallback((msg: string, err = false) => setT({ msg, err, id: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.err ? 4000 : 2200);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div key={t.id} className={`toast${t.err ? ' err' : ''}`} role="status">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Jalankan aksi async dengan toast error otomatis. */
export function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast((e as Error).message, true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

/* ---------- brand ---------- */
export function Brand({ sub = 'Padel & Badminton' }: { sub?: string }) {
  return (
    <Link to="/" className="brand" aria-label="match beranda">
      <span className="brand-mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="#C6FF3D" strokeWidth="2" />
          <path d="M12 5v14" stroke="#C6FF3D" strokeWidth="2" />
          <circle cx="16.5" cy="9.5" r="2.2" fill="#C6FF3D" />
        </svg>
      </span>
      <span>
        <div className="brand-name">
          match<span style={{ color: 'var(--lime-deep)' }}>.wins-court.com</span>
        </div>
        <div className="brand-sub">{sub}</div>
      </span>
    </Link>
  );
}

/* ---------- sheet ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="row-between">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Tutup">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- kontrol kecil ---------- */
export function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <span className="grow">
        <span className="label">{label}</span>
        {hint && <div className="hint">{hint}</div>}
      </span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 99, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Kurangi" onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <span className="val">{value}</span>
      <button type="button" aria-label="Tambah" onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

export function LevelBars({ level }: { level: number }) {
  return (
    <span className="lvl" title={levelName(level)} aria-label={levelName(level)}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Avatar({ name, gender }: { name: string; gender?: 'M' | 'F' }) {
  const ini = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return <span className={`avatar ${gender === 'F' ? 'f' : 'm'}`}>{ini || '?'}</span>;
}

export function SportChip({ sport }: { sport: Sport }) {
  return (
    <span className={`chip ${sport === 'padel' ? 'chip-padel' : 'chip-mint'}`}>
      {sport === 'padel' ? <Ball size={13} /> : <Shuttle size={13} />}
      {sport === 'padel' ? 'Padel' : 'Badminton'}
    </span>
  );
}

export function Loader({ sport = 'badminton', text = 'Memuat…' }: { sport?: Sport; text?: string }) {
  return (
    <div className="loader">
      {sport === 'padel' ? <Ball size={28} /> : <Shuttle size={30} />}
      <span>{text}</span>
    </div>
  );
}

/* ---------- konfeti geometris ---------- */
export function Confetti({ run }: { run: boolean }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        size: 6 + Math.random() * 8,
        dx: `${(Math.random() - 0.5) * 160}px`,
        rot: `${Math.random() * 720}deg`,
        delay: Math.random() * 0.35,
        shape: i % 3,
        color: ['var(--lime)', 'var(--mint)', 'var(--text)'][i % 3],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );
  const [show, setShow] = useState(run);
  useEffect(() => {
    if (!run) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, [run]);
  if (!show) return null;
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              width: p.shape === 2 ? 2 : p.size,
              height: p.shape === 2 ? p.size * 2 : p.size,
              borderRadius: p.shape === 0 ? '50%' : 2,
              background: p.color,
              animationDelay: `${p.delay}s`,
              '--dx': p.dx,
              '--rot': p.rot,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
