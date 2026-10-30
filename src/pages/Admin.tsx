import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtTime } from '../../shared/util.ts';
import { Download, Logout, Users } from '../components/Icons.tsx';
import { Brand, Loader, Seg, Sheet, SportChip, useToast } from '../components/ui.tsx';

const KEY = 'mwc.admin';

interface AdminUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  type: 'akun_umum' | 'penyewa_wins';
  created_at: number;
  account_created_at: number | null;
  sessions: number;
  last_activity: number | null;
}

interface AdminSession {
  slug: string;
  name: string;
  host: string;
  hostId: string;
  sport: 'badminton' | 'padel';
  format: string;
  start: string;
  end: string;
  status: 'draft' | 'running' | 'finished';
  manual: boolean;
  bookingId: string;
  players: number;
  matches: number;
  updatedAt: number;
}

interface Overview {
  stats: Record<'users' | 'accounts' | 'renters' | 'sessions' | 'running' | 'finished' | 'manual' | 'players' | 'matches', number>;
  users: AdminUser[];
  sessions: AdminSession[];
}

const store = {
  get: () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { token: string; expiresAt: number } | null;
      return v && v.expiresAt > Date.now() ? v.token : null;
    } catch {
      return null;
    }
  },
  set: (token: string, expiresAt: number) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, expiresAt }));
    } catch {
      /* mode privat */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* mode privat */
    }
  },
};

async function adminFetch(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.authorization = `Admin ${token}`;
  if (init.body) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/admin${path}`, { ...init, headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error((e as { error?: string }).error ?? `Gagal (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

const phoneFmt = (p: string) => (p.startsWith('62') ? `0${p.slice(2)}` : p);
const dt = (ms: number | null) => (ms ? `${fmtDate(new Date(ms).toISOString())} ${fmtTime(new Date(ms).toISOString())}` : '–');

export function Admin() {
  const [token, setToken] = useState<string | null>(() => store.get());
  if (!token) return <AdminLogin onDone={setToken} />;
  return (
    <Dashboard
      token={token}
      onLogout={() => {
        adminFetch('/logout', token, { method: 'POST' }).catch(() => {});
        store.clear();
        setToken(null);
      }}
    />
  );
}

function AdminLogin({ onDone }: { onDone: (t: string) => void }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch('/login', null, { method: 'POST', body: JSON.stringify({ user, password }) });
      const r = (await res.json()) as { token: string; expiresAt: number };
      store.set(r.token, r.expiresAt);
      onDone(r.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand sub="Admin" />
      </div>
      <form className="card stack" onSubmit={submit}>
        <h2>Masuk admin</h2>
        <label className="field">
          <span className="label">User</span>
          <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="banner banner-danger">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          Masuk
        </button>
      </form>
    </div>
  );
}

const EXPORTS = [
  { path: '/export/users.csv', label: 'Pengguna (CSV)', hint: 'Nama, no. HP, email, tipe, tanggal daftar' },
  { path: '/export/sessions.csv', label: 'Sesi (CSV)', hint: 'Semua sesi beserta host & status' },
  { path: '/export/matches.csv', label: 'Pertandingan (CSV)', hint: 'Setiap match, tim, skor, pemenang' },
  { path: '/export/standings.csv', label: 'Peringkat (CSV)', hint: 'Peringkat akhir tiap sesi' },
  { path: '/export/database.db', label: 'Backup database (.db)', hint: 'Seluruh data SQLite, buka dengan DB Browser for SQLite' },
];

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<'users' | 'sessions'>('users');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'akun_umum' | 'penyewa_wins'>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [reset, setReset] = useState<AdminUser | null>(null);
  const [newPin, setNewPin] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/overview', token);
      setData((await res.json()) as Overview);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onLogout();
      else toast((e as Error).message, true);
    }
  }, [token, onLogout, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (path: string) => {
    setDownloading(path);
    try {
      const res = await adminFetch(path, token);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? path.split('/').pop()!;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onLogout();
      else toast((e as Error).message, true);
    } finally {
      setDownloading(null);
    }
  };

  const doReset = async () => {
    if (!reset) return;
    try {
      const res = await adminFetch(`/users/${reset.id}/reset-pin`, token, { method: 'POST' });
      setNewPin(((await res.json()) as { pin: string }).pin);
    } catch (e) {
      toast((e as Error).message, true);
      setReset(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const users = useMemo(
    () =>
      (data?.users ?? []).filter(
        (u) =>
          (typeFilter === 'all' || u.type === typeFilter) &&
          (!needle || [u.name, u.phone, phoneFmt(u.phone), u.email ?? ''].some((v) => v.toLowerCase().includes(needle))),
      ),
    [data, needle, typeFilter],
  );
  const sessions = useMemo(
    () => (data?.sessions ?? []).filter((s) => !needle || [s.name, s.host, s.slug, s.format].some((v) => v.toLowerCase().includes(needle))),
    [data, needle],
  );

  if (!data) return <Loader text="Memuat data admin…" />;
  const st = data.stats;

  return (
    <div className="app admin stack-lg">
      <div className="topbar">
        <Brand sub="Admin" />
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>
          <Logout size={16} /> Keluar
        </button>
      </div>

      <div className="admin-stats">
        {[
          ['Pengguna', st.users, `${st.accounts} akun umum · ${st.renters} penyewa`],
          ['Sesi', st.sessions, `${st.running} berjalan · ${st.finished} selesai`],
          ['Sesi manual', st.manual, 'akun umum, disimpan 30 hari'],
          ['Pemain', st.players, `${st.matches} match selesai`],
        ].map(([label, n, sub]) => (
          <div key={label as string} className="card card-tight">
            <div className="eyebrow">{label}</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 800 }}>
              {n}
            </div>
            <div className="tiny mute">{sub}</div>
          </div>
        ))}
      </div>

      <section className="card stack">
        <div className="row" style={{ gap: 8 }}>
          <Download size={18} />
          <h3>Unduh data</h3>
        </div>
        <div className="admin-downloads">
          {EXPORTS.map((x) => (
            <button key={x.path} className="choice" disabled={downloading === x.path} onClick={() => download(x.path)}>
              <b>{downloading === x.path ? 'Menyiapkan…' : x.label}</b>
              <span>{x.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <div style={{ minWidth: 220 }}>
            <Seg
              value={tab}
              onChange={setTab}
              options={[
                { v: 'users', label: `Pengguna (${data.users.length})` },
                { v: 'sessions', label: `Sesi (${data.sessions.length})` },
              ]}
            />
          </div>
          <input className="input grow" style={{ minWidth: 200 }} placeholder={tab === 'users' ? 'Cari nama, no. HP, email…' : 'Cari sesi, host, format…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'users' && (
            <select className="select" style={{ width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="all">Semua tipe</option>
              <option value="akun_umum">Akun umum</option>
              <option value="penyewa_wins">Penyewa Wins Court</option>
            </select>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load}>
            Muat ulang
          </button>
        </div>

        {tab === 'users' ? (
          <div className="card card-tight admin-table">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Nama</th>
                  <th style={{ textAlign: 'left' }}>No. HP</th>
                  <th style={{ textAlign: 'left' }}>Email</th>
                  <th style={{ textAlign: 'left' }}>Tipe</th>
                  <th>Sesi</th>
                  <th style={{ textAlign: 'left' }}>Terdaftar</th>
                  <th style={{ textAlign: 'left' }}>Aktivitas terakhir</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ textAlign: 'left' }}>
                      <b>{u.name}</b>
                    </td>
                    <td style={{ textAlign: 'left' }} className="num">
                      <a href={`https://wa.me/${u.phone}`} target="_blank" rel="noreferrer">
                        {phoneFmt(u.phone)}
                      </a>
                    </td>
                    <td style={{ textAlign: 'left' }}>{u.email ?? <span className="whisper">–</span>}</td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`chip tiny ${u.type === 'akun_umum' ? 'chip-lime' : 'chip-mint'}`}>{u.type === 'akun_umum' ? 'Akun umum' : 'Penyewa Wins'}</span>
                    </td>
                    <td>{u.sessions}</td>
                    <td style={{ textAlign: 'left' }} className="tiny">
                      {dt(u.account_created_at ?? u.created_at)}
                    </td>
                    <td style={{ textAlign: 'left' }} className="tiny">
                      {dt(u.last_activity)}
                    </td>
                    <td>
                      {u.type === 'akun_umum' && (
                        <button className="btn btn-ghost btn-xs" onClick={() => (setNewPin(null), setReset(u))}>
                          Reset PIN
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={8} className="center mute">
                      <Users size={18} /> Tidak ada pengguna yang cocok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card card-tight admin-table">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Sesi</th>
                  <th style={{ textAlign: 'left' }}>Host</th>
                  <th style={{ textAlign: 'left' }}>Olahraga</th>
                  <th style={{ textAlign: 'left' }}>Jadwal</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th>Pemain</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.slug}>
                    <td style={{ textAlign: 'left' }}>
                      <Link to={`/s/${s.slug}`} target="_blank">
                        <b>{s.name}</b>
                      </Link>
                      <div className="tiny mute">
                        {s.format}
                        {s.manual ? ' · manual' : ` · ${s.bookingId}`}
                      </div>
                    </td>
                    <td style={{ textAlign: 'left' }}>{s.host}</td>
                    <td style={{ textAlign: 'left' }}>
                      <SportChip sport={s.sport} />
                    </td>
                    <td style={{ textAlign: 'left' }} className="tiny">
                      {fmtDate(s.start)}
                      <br />
                      {fmtTime(s.start)}–{fmtTime(s.end)}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`chip tiny ${s.status === 'running' ? 'chip-danger' : s.status === 'finished' ? '' : 'chip-outline'}`}>
                        {s.status === 'running' ? 'Berjalan' : s.status === 'finished' ? 'Selesai' : 'Belum mulai'}
                      </span>
                    </td>
                    <td>{s.players}</td>
                    <td>{s.matches}</td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="center mute">
                      Tidak ada sesi yang cocok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet open={!!reset} onClose={() => (setReset(null), setNewPin(null))} title="Reset PIN">
        {newPin ? (
          <>
            <p className="small">
              PIN baru untuk <b>{reset?.name}</b>:
            </p>
            <div className="num center" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.2em' }}>
              {newPin}
            </div>
            <p className="tiny mute">PIN ini hanya ditampilkan sekali. Berikan ke pengguna lewat WhatsApp, lalu minta ia masuk dengan PIN ini.</p>
            <button className="btn btn-dark btn-block" onClick={() => (setReset(null), setNewPin(null))}>
              Selesai
            </button>
          </>
        ) : (
          <>
            <p className="small mute">
              Buat PIN baru 6 digit untuk <b>{reset?.name}</b> ({reset && phoneFmt(reset.phone)}). PIN lama tidak berlaku lagi.
            </p>
            <button className="btn btn-primary btn-block" onClick={doReset}>
              Buat PIN baru
            </button>
          </>
        )}
      </Sheet>
    </div>
  );
}
