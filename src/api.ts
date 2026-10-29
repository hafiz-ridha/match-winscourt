import { useCallback, useEffect, useRef, useState } from 'react';
import type { Booking, Session } from '../shared/types.ts';

const HOST_KEY = 'mwc.host';

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* mode privat */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* mode privat */
    }
  },
};

export const auth = {
  get token() {
    return store.get(HOST_KEY);
  },
  set: (t: string) => store.set(HOST_KEY, t),
  clear: () => store.del(HOST_KEY),
  playerToken: (slug: string) => store.get(`mwc.p.${slug}`),
  setPlayerToken: (slug: string, t: string) => store.set(`mwc.p.${slug}`, t),
  clearPlayer: (slug: string) => store.del(`mwc.p.${slug}`),
  refKey: (slug: string) => store.get(`mwc.k.${slug}`),
  setRefKey: (slug: string, k: string) => store.set(`mwc.k.${slug}`, k),
  pref: (k: string) => store.get(`mwc.pref.${k}`),
  setPref: (k: string, v: string) => store.set(`mwc.pref.${k}`, v),
};

async function req<T>(path: string, opts: { method?: string; body?: unknown; slug?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const t = auth.token;
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.slug) {
    const pt = auth.playerToken(opts.slug);
    if (pt) headers['x-player-token'] = pt;
    const rk = auth.refKey(opts.slug);
    if (rk) headers['x-ref-key'] = rk;
  }
  const method = opts.method ?? 'GET';
  const send = () => fetch(`/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  let res: Response;
  try {
    res = await send();
  } catch {
    // Koneksi putus sesaat (mis. Safari memakai koneksi keep-alive yang sudah ditutup):
    // permintaan baca aman diulang sekali. Aksi (POST) tidak diulang agar tidak tercatat dua kali.
    if (method !== 'GET') throw new Error('Tidak ada koneksi. Coba lagi.');
    try {
      await new Promise((r) => setTimeout(r, 400));
      res = await send();
    } catch {
      throw new Error('Tidak ada koneksi. Coba lagi.');
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) auth.clear();
    throw new Error((data as { error?: string }).error ?? `Gagal (${res.status})`);
  }
  return data as T;
}

export interface SessionSummary {
  slug: string;
  name: string;
  sport: Session['sport'];
  format: Session['format'];
  status: Session['status'];
  start: string;
  end: string;
  courts: number;
  bookingId: string;
  players: number;
  waitlist: number;
}

export interface Me {
  host: { name: string; phone: string };
  bookings: Booking[];
  sessions: SessionSummary[];
}

export type Role = 'host' | 'referee' | 'player' | 'viewer';

export const api = {
  config: () => req<{ mock: boolean; mockAccounts: { name: string; phone: string; note: string }[] }>('/config'),
  login: (name: string, phone: string) => req<{ token: string } & Omit<Me, 'sessions'>>('/auth/login', { method: 'POST', body: { name, phone } }),
  me: () => req<Me>('/me'),
  createSession: (body: Record<string, unknown>) => req<{ slug: string }>('/sessions', { method: 'POST', body }),
  session: (slug: string) => req<{ session: Session; role: Role; playerId: string | null }>(`/s/${slug}`, { slug }),
  action: (slug: string, body: Record<string, unknown>) => req<{ session: Session }>(`/s/${slug}/action`, { method: 'POST', body, slug }),
  join: (slug: string, body: Record<string, unknown>) =>
    req<{ token: string; playerId: string; session: Session }>(`/s/${slug}/join`, { method: 'POST', body, slug }),
  remove: (slug: string) => req<{ ok: boolean }>(`/s/${slug}`, { method: 'DELETE', slug }),
};

/** Sesi live: ambil sekali lalu dengarkan perubahan lewat SSE. */
export function useLiveSession(slug: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>('viewer');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const latest = useRef(0);

  const accept = useCallback((s: Session) => {
    if (s.version >= latest.current) {
      latest.current = s.version;
      setSession(s);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await api.session(slug);
      latest.current = 0;
      accept(r.session);
      setRole(r.role);
      setPlayerId(r.playerId);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug, accept]);

  useEffect(() => {
    reload();
    let es: EventSource | null = null;
    let closed = false;
    const open = () => {
      if (closed) return;
      es = new EventSource(`/api/s/${slug}/stream`);
      es.onmessage = (ev) => {
        setOnline(true);
        try {
          const s = JSON.parse(ev.data) as Session;
          // Kunci wasit hanya dikirim ke host lewat GET; jangan ditimpa SSE.
          setSession((prev) => (prev && s.version < latest.current ? prev : { ...s, refKey: prev?.refKey || s.refKey }));
          latest.current = Math.max(latest.current, s.version);
        } catch {
          /* abaikan */
        }
      };
      es.onerror = () => setOnline(false);
    };
    // Safari menganggap halaman "masih memuat" selama koneksi live yang dibuka sebelum event load
    // masih terbuka (indikator loading tidak selesai). Buka koneksi live setelah halaman selesai dimuat.
    if (document.readyState === 'complete') open();
    else window.addEventListener('load', open, { once: true });
    return () => {
      closed = true;
      window.removeEventListener('load', open);
      es?.close();
    };
  }, [slug, reload]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await api.action(slug, body);
      setSession((prev) => ({ ...r.session, refKey: prev?.refKey || r.session.refKey }));
      latest.current = Math.max(latest.current, r.session.version);
      return r.session;
    },
    [slug],
  );

  /** Terima sesi dari respons aksi yang dikirim di luar `act` (mis. antrean wasit). */
  const setLocal = useCallback((s: Session) => {
    setSession((prev) => ({ ...s, refKey: prev?.refKey || s.refKey }));
    latest.current = Math.max(latest.current, s.version);
  }, []);

  return { session, role, playerId, error, online, reload, act, setLocal, setPlayerId, setRole };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
