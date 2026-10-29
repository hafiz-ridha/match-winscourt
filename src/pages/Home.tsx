import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { courtLabels, formatInfo } from '../../shared/formats.ts';
import type { Booking, Sport } from '../../shared/types.ts';
import { fmtDate, fmtTime } from '../../shared/util.ts';
import { api, auth, type Me } from '../api.ts';
import { CourtArt } from '../components/CourtArt.tsx';
import { Arrow, Ball, Lock, Logout, Plus, Shuttle, Whistle } from '../components/Icons.tsx';
import { Brand, Loader, Seg, SportChip, useRun } from '../components/ui.tsx';

export function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!auth.token);
  const [loggedIn, setLoggedIn] = useState(!!auth.token);

  useEffect(() => {
    if (!loggedIn) return;
    setLoading(true);
    api
      .me()
      .then(setMe)
      .catch(() => {
        auth.clear();
        setLoggedIn(false);
      })
      .finally(() => setLoading(false));
  }, [loggedIn]);

  if (!loggedIn) return <Login onDone={() => setLoggedIn(true)} />;
  if (loading || !me) return <Loader text="Memuat booking kamu…" />;
  return (
    <HostHome
      me={me}
      onLogout={() => {
        auth.clear();
        setMe(null);
        setLoggedIn(false);
      }}
    />
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ name: string; phone: string; note: string }[]>([]);
  const { run, busy } = useRun();
  const nav = useNavigate();

  useEffect(() => {
    api.config().then((c) => setDemo(c.mockAccounts)).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.login(name, phone);
      auth.set(r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openLink = (e: FormEvent) => {
    e.preventDefault();
    const m = link.trim().match(/(?:\/s\/)?([a-z0-9]{6,})\/?$/i);
    if (m) nav(`/s/${m[1]}`);
  };

  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand />
      </div>
      <div className="card hero stack rise">
        <span className="eyebrow">Padel & Badminton · Wins Court</span>
        <HeroCourt />
        <h1>
          Mabar rapi, <span style={{ color: 'var(--lime-deep)' }}>skor langsung jadi.</span>
        </h1>
        <p className="mute small">Susun pertandingan adil otomatis, catat skor dari HP, dan lihat peringkat live. Gratis, semua fitur.</p>
      </div>

      <form className="card stack rise" style={{ animationDelay: '80ms' }} onSubmit={submit}>
        <div>
          <h2>Masuk sebagai host</h2>
          <p className="small mute" style={{ marginTop: 4 }}>
            Pakai nama dan no. HP yang tercatat saat booking lapangan di Wins Court.
          </p>
        </div>
        <label className="field">
          <span className="label">Nama penyewa</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Budi Santoso" autoComplete="name" required />
        </label>
        <label className="field">
          <span className="label">No. HP</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xx xxxx xxxx" inputMode="tel" autoComplete="tel" required />
        </label>
        {error && (
          <div className="banner banner-danger stack" style={{ gap: 8 }}>
            <span>{error}</span>
            {error.includes('tidak ditemukan') && (
              <a className="btn btn-sm btn-ghost" href="https://wa.me/6285188369226?text=Halo%20WinsCourt%2C%20saya%20mau%20reservasi%20lapangan." target="_blank" rel="noreferrer">
                Booking via WhatsApp admin
              </a>
            )}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          Masuk <Arrow size={18} />
        </button>
        {demo.length > 0 && (
          <div className="card card-surface card-tight stack" style={{ gap: 8 }}>
            <div className="eyebrow">Mode demo · data booking contoh</div>
            {demo.map((d) => (
              <button
                key={d.phone}
                type="button"
                className="row-between"
                style={{ border: 0, background: 'transparent', padding: '4px 0', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => {
                  setName(d.name);
                  setPhone(d.phone);
                  run(async () => {
                    const r = await api.login(d.name, d.phone);
                    auth.set(r.token);
                    onDone();
                  });
                }}
              >
                <span>
                  <b className="small">{d.name}</b>
                  <div className="tiny mute">{d.note}</div>
                </span>
                <Arrow size={16} />
              </button>
            ))}
          </div>
        )}
      </form>

      <form className="card stack rise" style={{ animationDelay: '160ms' }} onSubmit={openLink}>
        <div>
          <h3>Pemain? Buka link sesi</h3>
          <p className="small mute">Tempel link dari host, atau minta host membagikannya di grup.</p>
        </div>
        <div className="row">
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="match.wins-court.com/s/…" />
          <button className="btn btn-dark">Buka</button>
        </div>
      </form>

      <div className="card stack rise" style={{ animationDelay: '220ms' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="icon-btn" style={{ background: 'var(--text)', color: 'var(--lime)', borderColor: 'transparent' }}>
            <Whistle size={20} />
          </span>
          <div className="grow">
            <h3>Papan skor lokal</h3>
            <p className="small mute">Catat skor satu pertandingan langsung dari HP. Tanpa login, tanpa internet.</p>
          </div>
        </div>
        <div className="row">
          <Link to="/wasit-lokal?sport=badminton" className="btn btn-ghost grow">
            <Shuttle size={20} /> Badminton
          </Link>
          <Link to="/wasit-lokal?sport=padel" className="btn btn-ghost grow">
            <Ball size={18} /> Padel
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Lapangan bergantian: badminton (kok) ↔ padel (bola), digambar ulang tiap ganti. */
function HeroCourt({ initial = 'badminton' }: { initial?: Sport }) {
  const [sport, setSport] = useState<Sport>(initial);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setSport((x) => (x === 'badminton' ? 'padel' : 'badminton')), 7000);
    return () => clearInterval(t);
  }, [auto]);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="court-stage">
        <CourtArt key={sport} sport={sport} />
      </div>
      <div className="sport-switch" role="radiogroup" aria-label="Pilih olahraga">
        {(['badminton', 'padel'] as Sport[]).map((sp) => (
          <button
            key={sp}
            type="button"
            role="radio"
            aria-checked={sport === sp}
            className={`${sp}${sport === sp ? ' on' : ''}`}
            onClick={() => {
              setAuto(false);
              setSport(sp);
            }}
          >
            {sp === 'padel' ? <Ball size={24} /> : <Shuttle size={26} />}
            {sp === 'padel' ? 'Padel' : 'Badminton'}
          </button>
        ))}
      </div>
    </div>
  );
}

function bookingLabel(b: Booking) {
  const courts = b.sport === 'padel' ? 'Lapangan Padel' : courtLabels(b.sport, b.courts).join(', ');
  return `${courts} · ${fmtTime(b.start)}–${fmtTime(b.end)}`;
}

function HostHome({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [tab, setTab] = useState<'next' | 'done'>('next');
  const nav = useNavigate();
  const sessionFor = (b: Booking) => me.sessions.find((s) => s.bookingId === b.id);
  const upcoming = me.sessions.filter((s) => s.status !== 'finished');
  const finished = me.sessions.filter((s) => s.status === 'finished');
  const list = tab === 'next' ? upcoming : finished;
  const totalPlayers = upcoming.reduce((a, s) => a + s.players, 0);
  const free = me.bookings.filter((b) => !sessionFor(b) && new Date(b.end).getTime() > Date.now());
  const first = me.bookings[0];

  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand sub="Mode host" />
        <button className="icon-btn" onClick={onLogout} aria-label="Keluar" title="Keluar">
          <Logout size={18} />
        </button>
      </div>

      <div>
        <div className="small mute">Halo,</div>
        <h1>{me.host.name}</h1>
      </div>

      <div className="card hero stack rise">
        <div className="row-between">
          <span className="chip chip-outline">
            <span className="dot" style={{ color: 'var(--lime-deep)' }} /> Minggu ini
          </span>
          <span className="tiny mute">{me.host.phone}</span>
        </div>
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <h2 style={{ fontSize: 26 }}>
            Sesi rapi,
            <br />
            <span style={{ color: 'var(--lime-deep)' }}>tanpa drama.</span>
          </h2>
          <div className="row">
            <div className="card card-tight" style={{ padding: '8px 12px', borderRadius: 14 }}>
              <div className="num" style={{ fontWeight: 800, fontSize: 18 }}>{upcoming.length}</div>
              <div className="tiny mute">sesi aktif</div>
            </div>
            <div className="card card-tight" style={{ padding: '8px 12px', borderRadius: 14 }}>
              <div className="num" style={{ fontWeight: 800, fontSize: 18 }}>{totalPlayers}</div>
              <div className="tiny mute">pemain</div>
            </div>
          </div>
        </div>
        <HeroCourt initial={first?.sport ?? 'badminton'} />
      </div>

      <section className="stack">
        <div>
          <div className="eyebrow">Dari Wins Court</div>
          <h2>Booking kamu</h2>
        </div>
        {me.bookings.length === 0 && <div className="card card-surface small mute">Tidak ada booking untuk 7 hari ke depan.</div>}
        {me.bookings.map((b, i) => {
          const s = sessionFor(b);
          const past = new Date(b.end).getTime() < Date.now();
          return (
            <div key={b.id} className="card card-tight stack rise" style={{ animationDelay: `${i * 60}ms`, gap: 10 }}>
              <div className="row-between">
                <SportChip sport={b.sport} />
                <span className="tiny mute">
                  <Lock size={12} /> {b.id}
                </span>
              </div>
              <div>
                <b>{fmtDate(b.start)}</b>
                <div className="small mute">{bookingLabel(b)}</div>
              </div>
              {s ? (
                <Link to={`/s/${s.slug}`} className="btn btn-dark btn-sm">
                  Buka sesi “{s.name}” <Arrow size={16} />
                </Link>
              ) : past ? (
                <span className="tiny mute">Jam main sudah lewat</span>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => nav(`/baru/${b.id}`)}>
                  <Plus size={16} /> Buat sesi
                </button>
              )}
            </div>
          );
        })}
        {free.length === 0 && me.bookings.length > 0 && <p className="tiny mute center">Semua booking aktif sudah punya sesi.</p>}
      </section>

      <section className="stack">
        <div>
          <div className="eyebrow">Jadwal</div>
          <h2>Sesi kamu</h2>
        </div>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: 'next', label: `Akan datang (${upcoming.length})` },
            { v: 'done', label: `Selesai (${finished.length})` },
          ]}
        />
        {list.length === 0 && <div className="card card-surface small mute center">Belum ada sesi.</div>}
        {list.map((s, i) => (
          <Link key={s.slug} to={`/s/${s.slug}`} className="card card-link card-tight stack rise" style={{ animationDelay: `${i * 50}ms`, gap: 8 }}>
            <div className="row wrap">
              <span className={`chip ${s.status === 'running' ? 'chip-danger' : s.status === 'finished' ? '' : 'chip-outline'}`}>
                {s.status === 'running' && <span className="dot dot-live" />}
                {s.status === 'running' ? 'Berjalan' : s.status === 'finished' ? 'Selesai' : 'Belum mulai'}
              </span>
              <SportChip sport={s.sport} />
              <span className="chip">{formatInfo(s.format).name}</span>
            </div>
            <h3>{s.name}</h3>
            <div className="small mute">
              {fmtDate(s.start)} · {fmtTime(s.start)}–{fmtTime(s.end)} · {s.courts} lapangan
            </div>
            <div className="row small">
              <b>{s.players}</b> <span className="mute">pemain</span>
              {s.waitlist > 0 && <span className="chip chip-warn">{s.waitlist} menunggu</span>}
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
