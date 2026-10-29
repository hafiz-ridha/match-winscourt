import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courtLabels, defaultRules, defaultSettings, formatsFor } from '../../shared/formats.ts';
import type { Booking, FormatId, ScoreRules, SessionSettings } from '../../shared/types.ts';
import { fmtDate, fmtTime } from '../../shared/util.ts';
import { api, auth } from '../api.ts';
import { CourtArt } from '../components/CourtArt.tsx';
import { Back, Chevron, Lock } from '../components/Icons.tsx';
import { RulesEditor, SettingsEditor } from '../components/RulesEditor.tsx';
import { Brand, Loader, Seg, SportChip, Stepper, useRun } from '../components/ui.tsx';

export function CreateSession() {
  const { bookingId } = useParams();
  const nav = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.token) {
      nav('/');
      return;
    }
    api
      .me()
      .then((me) => {
        if (bookingId === 'manual') {
          if (me.account) setBooking(manualDefault());
          else setError('Sesi manual hanya untuk akun umum. Keluar lalu daftar/masuk lewat tab "Akun umum".');
          return;
        }
        const b = me.bookings.find((x) => x.id === bookingId);
        const existing = me.sessions.find((s) => s.bookingId === bookingId);
        if (existing) nav(`/s/${existing.slug}`, { replace: true });
        else if (b) setBooking(b);
        else setError('Booking tidak ditemukan untuk akun ini.');
      })
      .catch((e) => setError(e.message));
  }, [bookingId, nav]);

  if (error)
    return (
      <div className="app">
        <div className="card stack center" style={{ marginTop: 40 }}>
          <p>{error}</p>
          <Link to="/" className="btn btn-primary">
            Kembali
          </Link>
        </div>
      </div>
    );
  if (!booking) return <Loader />;
  return <Form initial={booking} manual={bookingId === 'manual'} />;
}

/** Tanggal hari ini (WIB) + n hari, format YYYY-MM-DD. */
const wibDate = (plusDays = 0) => new Date(Date.now() + 7 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

/** Jam penuh berikutnya (WIB), format HH:00. */
function nextHour(add = 1) {
  const h = (new Date(Date.now() + 7 * 3600_000).getUTCHours() + add) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

function manualDefault(): Booking {
  const start = nextHour(1);
  const end = nextHour(3);
  const date = start > end ? wibDate(1) : wibDate(0);
  return { id: 'manual', name: '', phone: '', sport: 'badminton', courts: [1, 2], start: `${date}T${start}:00+07:00`, end: `${date}T${end}:00+07:00` };
}

function Form({ initial, manual }: { initial: Booking; manual: boolean }) {
  const nav = useNavigate();
  const { run, busy } = useRun();
  // Sesi manual: olahraga, tanggal, jam & jumlah lapangan diisi sendiri.
  const [mSport, setMSport] = useState<Booking['sport']>(initial.sport);
  const [mDate, setMDate] = useState(initial.start.slice(0, 10));
  const [mStart, setMStart] = useState(initial.start.slice(11, 16));
  const [mEnd, setMEnd] = useState(initial.end.slice(11, 16));
  const [mCourts, setMCourts] = useState(initial.courts.length);
  const booking: Booking = manual
    ? {
        ...initial,
        sport: mSport,
        courts: Array.from({ length: mSport === 'padel' ? 1 : mCourts }, (_, i) => i + 1),
        start: `${mDate}T${mStart}:00+07:00`,
        end: `${mDate}T${mEnd === '24:00' ? '23:59' : mEnd}:00+07:00`,
      }
    : initial;
  const courts = booking.sport === 'padel' ? 1 : Math.min(4, booking.courts.length);
  const formats = useMemo(() => formatsFor(booking.sport, courts), [booking.sport, courts]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<FormatId>(booking.sport === 'badminton' ? 'rotation' : 'americano');
  const [teamSize, setTeamSize] = useState<1 | 2>(2);
  const [rules, setRules] = useState<ScoreRules>(defaultRules(booking.sport));
  const [settings, setSettings] = useState<SessionSettings>(defaultSettings());
  const [maxPlayers, setMaxPlayers] = useState('');
  const [names, setNames] = useState('');
  // Ganti olahraga (sesi manual) → format & aturan skor kembali ke bawaan olahraga itu.
  useEffect(() => {
    if (!manual) return;
    setFormat(mSport === 'badminton' ? 'rotation' : 'americano');
    setRules(defaultRules(mSport));
  }, [mSport, manual]);
  const fmt = formats.find((f) => f.id === format) ?? formats[0];
  const singlesAllowed = booking.sport === 'badminton' && !fmt.mixed;

  const submit = () =>
    run(async () => {
      const r = await api.createSession({
        ...(manual ? { manual: { sport: mSport, date: mDate, start: mStart, end: mEnd, courts: mCourts } } : { bookingId: booking.id }),
        name,
        format,
        teamSize: singlesAllowed ? teamSize : 2,
        rules,
        settings,
        maxPlayers: maxPlayers ? Number(maxPlayers) : null,
        names: names
          .split(/\n|,/)
          .map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim())
          .filter(Boolean),
      });
      nav(`/s/${r.slug}`, { replace: true });
    });

  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand sub="Mode host" />
      </div>
      <div className="row">
        <Link to="/" className="icon-btn" aria-label="Kembali">
          <Back size={18} />
        </Link>
        <div>
          <h1 style={{ fontSize: 26 }}>Buat sesi</h1>
          <p className="small mute">Isi yang penting aja. Sisanya bisa diubah kapan pun.</p>
        </div>
      </div>

      {manual ? (
        <div className="card hero stack rise">
          <div className="row-between">
            <span className="eyebrow">Sesi manual</span>
            <span className="chip chip-outline tiny">Tanpa booking Wins Court</span>
          </div>
          <div className="sport-switch" role="radiogroup" aria-label="Olahraga">
            {(['badminton', 'padel'] as const).map((sp) => (
              <button key={sp} type="button" role="radio" aria-checked={mSport === sp} className={`${sp}${mSport === sp ? ' on' : ''}`} onClick={() => setMSport(sp)}>
                {sp === 'padel' ? 'Padel' : 'Badminton'}
              </button>
            ))}
          </div>
          <div className="court-stage">
            <CourtArt key={mSport} sport={mSport} teamSize={singlesAllowed ? teamSize : 2} players={false} />
          </div>
          <label className="field">
            <span className="label">Tanggal main</span>
            <input className="input" type="date" value={mDate} min={wibDate(0)} max={wibDate(60)} onChange={(e) => setMDate(e.target.value)} required />
          </label>
          <div className="row">
            <label className="field grow">
              <span className="label">Jam mulai</span>
              <input className="input" type="time" step={900} value={mStart} onChange={(e) => setMStart(e.target.value)} required />
            </label>
            <label className="field grow">
              <span className="label">Jam selesai</span>
              <input className="input" type="time" step={900} value={mEnd} onChange={(e) => setMEnd(e.target.value)} required />
            </label>
          </div>
          {mSport === 'badminton' ? (
            <div className="field">
              <span className="label">Jumlah lapangan</span>
              <Stepper value={mCourts} min={1} max={4} onChange={setMCourts} />
              <span className="hint">Badminton maksimal 4 lapangan.</span>
            </div>
          ) : (
            <p className="hint">Padel: 1 lapangan.</p>
          )}
        </div>
      ) : (
      <div className="card hero stack rise" style={{ gap: 10 }}>
        <div className="row-between">
          <SportChip sport={booking.sport} />
          <span className="chip chip-outline tiny">
            <Lock size={12} /> Dari booking {booking.id}
          </span>
        </div>
        <CourtArt sport={booking.sport} teamSize={singlesAllowed ? teamSize : 2} />
        <div className="row-between small">
          <span>
            <b>{fmtDate(booking.start)}</b>
            <div className="mute">
              {fmtTime(booking.start)}–{fmtTime(booking.end)}
            </div>
          </span>
          <span style={{ textAlign: 'right' }}>
            <b>{courts} lapangan</b>
            <div className="mute">{courtLabels(booking.sport, booking.courts).join(', ')}</div>
          </span>
        </div>
        <p className="tiny mute">Olahraga, lapangan, dan jam main mengikuti booking dan tidak bisa diubah.</p>
      </div>
      )}

      <div className="card stack rise" style={{ animationDelay: '60ms' }}>
        <label className="field">
          <span className="label">Nama sesi</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Mabar Kamis Malam" maxLength={60} />
        </label>

        <div className="field">
          <span className="label">Mode</span>
          <div className="choice-grid">
            {formats.map((f) => (
              <button key={f.id} type="button" className={`choice${f.id === format ? ' on' : ''}`} onClick={() => setFormat(f.id)}>
                <b>{f.name}</b>
                <span>{f.desc}</span>
              </button>
            ))}
          </div>
          {booking.sport === 'padel' && <span className="hint">King of the Court butuh minimal 2 lapangan, jadi diganti Pemenang Bertahan.</span>}
        </div>

        {singlesAllowed && (
          <div className="field">
            <span className="label">Main</span>
            <Seg
              value={teamSize}
              onChange={setTeamSize}
              options={[
                { v: 2, label: 'Ganda' },
                { v: 1, label: 'Tunggal' },
              ]}
            />
          </div>
        )}

        <RulesEditor sport={booking.sport} rules={rules} onChange={setRules} />

        <label className="field">
          <span className="label">Batas pemain</span>
          <input className="input" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value.replace(/\D/g, ''))} placeholder="Tanpa batas" inputMode="numeric" />
          <span className="hint">Kosongkan untuk tanpa batas. Pemain yang gabung lewat link masuk waitlist dulu, kamu yang setujui.</span>
        </label>

        <label className="field">
          <span className="label">Pemain yang main hari ini</span>
          <textarea className="textarea" value={names} onChange={(e) => setNames(e.target.value)} placeholder={'Opsional. Satu nama per baris, atau tempel daftar dari grup WhatsApp.'} />
          <span className="hint">
            {names.split(/\n|,/).filter((x) => x.trim()).length} nama · level & gender bisa diatur setelah disimpan.
          </span>
        </label>

        <details className="adv">
          <summary>
            Pengaturan lanjutan <Chevron size={18} className="chev" />
          </summary>
          <div style={{ marginTop: 14 }}>
            <SettingsEditor format={format} settings={settings} onChange={setSettings} />
          </div>
        </details>

        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
          Simpan & atur sesi
        </button>
      </div>

      <div className="card card-surface stack small">
        <div className="eyebrow">Setelah ini</div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <b className="num">1</b>
          <span>
            <b>Bagikan link sesi.</b> Pemain login dengan nickname + PIN 4 angka, lalu masuk waitlist sampai kamu setujui.
          </span>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <b className="num">2</b>
          <span>
            <b>Tekan Mulai</b> (aktif 15 menit sebelum jam main). Sistem menyusun ronde ke depan.
          </span>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <b className="num">3</b>
          <span>
            <b>Jalankan & catat skor.</b> Host bisa menimpa susunan kapan saja.
          </span>
        </div>
      </div>
    </div>
  );
}
