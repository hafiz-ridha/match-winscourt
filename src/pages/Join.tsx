import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LEVELS, levelName } from '../../shared/formats.ts';
import type { Gender, Level, Player } from '../../shared/types.ts';
import { api, auth, useLiveSession } from '../api.ts';
import { CourtArt } from '../components/CourtArt.tsx';
import { Back } from '../components/Icons.tsx';
import { Avatar, Brand, Loader, Seg, Sheet, SportChip, useRun } from '../components/ui.tsx';

type Tab = 'pick' | 'login' | 'new';

const pinInput = (value: string, set: (v: string) => void, autoFocus = false) => (
  <input
    className="input input-pin"
    placeholder="••••"
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={4}
    value={value}
    autoFocus={autoFocus}
    onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 4))}
    aria-label="PIN 4 angka"
  />
);

/** Halaman pemain dari link sesi: pilih nama / masuk dengan PIN / daftar baru (ala Kourt). */
export function Join() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const { session: s, playerId, error } = useLiveSession(slug);
  const [tab, setTab] = useState<Tab>('pick');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [claim, setClaim] = useState<Player | null>(null);
  const [claimPin, setClaimPin] = useState('');
  const [gender, setGender] = useState<Gender>('M');
  const [level, setLevel] = useState<Level>(1);
  const { run, busy } = useRun();

  if (error && !s)
    return (
      <div className="app">
        <div className="card stack center">
          <p>{error}</p>
          <Link to="/" className="btn btn-primary">
            Beranda
          </Link>
        </div>
      </div>
    );
  if (!s) return <Loader />;

  const me = s.players.find((p) => p.id === playerId);
  const list = s.players.filter((p) => p.status !== 'left').sort((x, y) => x.name.localeCompare(y.name));

  const join = (body: Record<string, unknown>) =>
    run(async () => {
      const r = await api.join(slug, body);
      auth.setPlayerToken(slug, r.token);
      nav(`/s/${slug}`, { replace: true });
    });

  const submitLogin = (e: FormEvent) => {
    e.preventDefault();
    join({ mode: 'login', name, pin });
  };
  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    join({ mode: 'new', name, pin, gender, level });
  };

  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand sub="Mode pemain" />
      </div>
      <div className="row">
        <Link to={`/s/${slug}`} className="icon-btn" aria-label="Kembali ke sesi">
          <Back size={18} />
        </Link>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="small mute">{s.name}</span>
          <span className={`chip tiny ${s.status === 'running' ? 'chip-danger' : 'chip-outline'}`}>
            {s.status === 'running' ? 'Sedang berjalan' : s.status === 'finished' ? 'Selesai' : 'Belum mulai'}
          </span>
        </div>
      </div>
      <h1>
        Kamu yang <span style={{ color: 'var(--lime-deep)' }}>mana?</span>
      </h1>

      {me && (
        <div className="banner banner-lime row-between">
          <span>
            Kamu sudah masuk sebagai <b>{me.name}</b>.
          </span>
          <Link to={`/s/${slug}`} className="btn btn-dark btn-xs">
            Buka sesi
          </Link>
        </div>
      )}

      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { v: 'pick', label: 'Pilih nama' },
          { v: 'login', label: 'Masuk' },
          ...(s.status !== 'finished' ? [{ v: 'new' as Tab, label: 'Daftar baru' }] : []),
        ]}
      />

      {tab === 'pick' && (
        <div className="card stack">
          <div>
            <h3>Ketuk namamu</h3>
            <p className="small mute">
              Pertama kali? Ketuk <b>Ini aku</b> lalu buat PIN 4 angka. Sudah punya PIN? Ketuk <b>Masuk</b>.
            </p>
          </div>
          {list.length === 0 && <p className="small mute">Belum ada nama di sesi ini. Pakai tab Daftar baru.</p>}
          <div className="plist">
            {list.map((p) => (
              <div key={p.id} className="prow">
                <Avatar name={p.name} gender={p.gender} />
                <div className="grow">
                  <b className="small">{p.name}</b>
                  <div className="tiny mute">
                    {p.status === 'waitlist' ? 'Menunggu persetujuan' : p.hasPin ? 'Sudah punya PIN' : 'Belum punya PIN'} · {levelName(p.level)}
                  </div>
                </div>
                {p.hasPin ? (
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setName(p.name);
                      setPin('');
                      setTab('login');
                    }}
                  >
                    Masuk
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-xs"
                    onClick={() => {
                      setClaim(p);
                      setClaimPin('');
                    }}
                  >
                    Ini aku
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="tiny mute">Namamu tidak ada? Pakai tab Daftar baru, atau minta host menambahkan namamu.</p>
        </div>
      )}

      {tab === 'login' && (
        <form className="card stack" onSubmit={submitLogin}>
          <h3>Masuk</h3>
          <label className="field">
            <span className="label">Nama</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama yang dipakai di daftar sesi" required />
          </label>
          <label className="field">
            <span className="label">PIN 4 angka</span>
            {pinInput(pin, setPin, !!name)}
            <span className="hint">Lupa PIN? Minta host mereset.</span>
          </label>
          <button className="btn btn-dark btn-block" disabled={busy || pin.length !== 4 || !name.trim()}>
            Masuk
          </button>
          <p className="tiny mute center">Belum pernah masuk? Pilih namamu di tab Pilih nama.</p>
        </form>
      )}

      {tab === 'new' && (
        <form className="card stack" onSubmit={submitNew}>
          <div>
            <h3>Daftar ke sesi</h3>
            <p className="small mute">Kamu masuk waitlist sampai host menyetujui.</p>
          </div>
          <label className="field">
            <span className="label">Nickname</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          </label>
          <label className="field">
            <span className="label">Buat PIN 4 angka</span>
            {pinInput(pin, setPin)}
            <span className="hint">Dipakai untuk masuk lagi dari HP lain.</span>
          </label>
          <div className="field">
            <span className="label">Gender</span>
            <Seg
              value={gender}
              onChange={setGender}
              options={[
                { v: 'M', label: '♂ Putra' },
                { v: 'F', label: '♀ Putri' },
              ]}
            />
          </div>
          <div className="field">
            <span className="label">Level kamu</span>
            <Seg value={level} onChange={(v) => setLevel(v as Level)} options={LEVELS.map((l) => ({ v: l.v as Level, label: l.name }))} />
            <span className="hint">Host bisa menyesuaikan level agar pertandingan seimbang.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || pin.length !== 4 || !name.trim()}>
            Daftar
          </button>
        </form>
      )}

      <div className="card card-surface stack" style={{ gap: 6 }}>
        <SportChip sport={s.sport} />
        <CourtArt sport={s.sport} />
      </div>

      <Sheet open={!!claim} onClose={() => setClaim(null)} title={claim ? `Hai, ${claim.name}!` : ''}>
        <p className="small mute">Buat PIN 4 angka. PIN ini dipakai untuk masuk lagi ke sesi ini.</p>
        {pinInput(claimPin, setClaimPin, true)}
        <button
          className="btn btn-primary btn-block"
          disabled={busy || claimPin.length !== 4}
          onClick={() => claim && join({ mode: 'claim', name: claim.name, pin: claimPin })}
        >
          Simpan PIN & masuk
        </button>
      </Sheet>
    </div>
  );
}
