import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { currentRound } from '../../shared/engine.ts';
import { formatInfo, rulesLabel } from '../../shared/formats.ts';
import type { Session } from '../../shared/types.ts';
import { fmtDate, fmtDuration, fmtTime } from '../../shared/util.ts';
import { auth, useLiveSession, useNow, type Role } from '../api.ts';
import { Alert, Back, Clock, Court, Gear, Info, Trophy, Users } from '../components/Icons.tsx';
import { Brand, Loader, SportChip } from '../components/ui.tsx';
import { CourtsTab } from './session/CourtsTab.tsx';
import type { Ctx } from './session/helpers.ts';
import { PlayersTab } from './session/PlayersTab.tsx';
import { RankTab } from './session/RankTab.tsx';
import { RulesTab } from './session/RulesTab.tsx';
import { SettingsTab } from './session/SettingsTab.tsx';

type Tab = 'courts' | 'players' | 'rank' | 'settings' | 'rules';

export function SessionPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const key = params.get('key');
  if (key) auth.setRefKey(slug, key);
  const live = useLiveSession(slug);
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') as Tab) || 'courts');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  if (live.error && !live.session)
    return (
      <div className="app">
        <div className="topbar">
          <Brand />
        </div>
        <div className="card stack center">
          <h2>Sesi tidak bisa dibuka</h2>
          <p className="small mute">{live.error}</p>
          <Link to="/" className="btn btn-primary">
            Ke beranda
          </Link>
        </div>
      </div>
    );
  if (!live.session) return <Loader />;

  const s = live.session;
  const isHost = live.role === 'host';
  const ctx: Ctx = {
    s,
    role: live.role,
    playerId: live.playerId,
    act: live.act,
    isHost,
    canScore: isHost || live.role === 'referee' || !!auth.refKey(slug),
  };
  const waitlist = s.players.filter((p) => p.status === 'waitlist').length;
  const info = formatInfo(s.format);

  return (
    <div className="app stack-lg">
      <div className="topbar">
        <Brand sub={isHost ? 'Mode host' : live.role === 'player' ? 'Mode pemain' : live.role === 'referee' ? 'Mode wasit' : 'Padel & Badminton'} />
        {!live.online && <span className="chip chip-warn tiny">Menyambung ulang…</span>}
      </div>

      <RoleBar s={s} role={live.role} playerId={live.playerId} />

      <header className="stack" style={{ gap: 10 }}>
        <div className="row">
          {isHost && (
            <Link to="/" className="icon-btn" aria-label="Kembali">
              <Back size={18} />
            </Link>
          )}
          <span className={`chip ${s.status === 'running' ? 'chip-danger' : s.status === 'finished' ? '' : 'chip-outline'}`}>
            {s.status === 'running' && <span className="dot dot-live" />}
            {s.status === 'running' ? 'Berjalan' : s.status === 'finished' ? 'Selesai' : 'Belum mulai'}
          </span>
        </div>
        <h1>{s.name}</h1>
        <div className="row wrap" style={{ gap: 6 }}>
          <SportChip sport={s.sport} />
          <span className="chip">{info.name}</span>
          <span className="chip">{s.courts} lapangan</span>
          <span className="chip">{s.teamSize === 1 ? 'Tunggal' : 'Ganda'}</span>
          <span className="chip">{s.players.filter((p) => p.status !== 'waitlist' && p.status !== 'left').length} pemain</span>
          {waitlist > 0 && <span className="chip chip-warn">{waitlist} waitlist</span>}
        </div>
        <div className="small mute row">
          <Clock size={14} /> {fmtDate(s.start)} · {fmtTime(s.start)}–{fmtTime(s.end)} · {rulesLabel(s.rules)}
        </div>
        <PlayTime s={s} isHost={isHost} />
      </header>

      {tab === 'courts' && <CourtsTab ctx={ctx} onTab={(t) => setTab(t as Tab)} />}
      {tab === 'players' && <PlayersTab ctx={ctx} />}
      {tab === 'rank' && <RankTab ctx={ctx} />}
      {tab === 'settings' && isHost && <SettingsTab ctx={ctx} />}
      {tab === 'rules' && !isHost && <RulesTab ctx={ctx} />}

      <nav className="bottomnav no-print" aria-label="Navigasi sesi">
        <button className={tab === 'courts' ? 'on' : ''} onClick={() => setTab('courts')}>
          <Court size={20} />
          Lapangan
        </button>
        <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
          <Users size={20} />
          Pemain
          {isHost && waitlist > 0 && <span className="badge">{waitlist}</span>}
        </button>
        <button className={tab === 'rank' ? 'on' : ''} onClick={() => setTab('rank')}>
          <Trophy size={20} />
          Peringkat
        </button>
        {isHost ? (
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            <Gear size={20} />
            Atur
          </button>
        ) : (
          <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
            <Info size={20} />
            Aturan
          </button>
        )}
      </nav>
    </div>
  );
}

/** Keterangan peran di atas halaman: host, pemain, wasit, atau penonton. */
function RoleBar({ s, role, playerId }: { s: Session; role: Role; playerId: string | null }) {
  const me = s.players.find((p) => p.id === playerId);
  const statusLabel: Record<string, string> = { waitlist: 'menunggu persetujuan', active: 'aktif', rest: 'istirahat', late: 'terlambat', left: 'sudah pulang' };
  if (role === 'host')
    return (
      <div className="banner banner-lime row-between" style={{ alignItems: 'center' }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="chip chip-dark">HOST</span>
          <span className="small">
            Kamu host sesi ini · <b>{s.hostName}</b>
          </span>
        </span>
        <Gear size={16} />
      </div>
    );
  if (role === 'player' && me)
    return (
      <div className="banner banner-lime row-between" style={{ alignItems: 'center' }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="chip chip-lime" style={{ background: 'var(--card)' }}>
            PEMAIN
          </span>
          <span className="small">
            Kamu masuk sebagai <b>{me.name}</b> · {statusLabel[me.status]}
          </span>
        </span>
      </div>
    );
  if (role === 'referee')
    return (
      <div className="banner banner-warn row" style={{ alignItems: 'center', gap: 8 }}>
        <span className="chip chip-dark">WASIT</span>
        <span className="small">Kamu bisa mencatat skor. Pengaturan hanya oleh host ({s.hostName}).</span>
      </div>
    );
  return (
    <div className="card card-surface card-tight row-between" style={{ alignItems: 'center' }}>
      <span className="row" style={{ gap: 8 }}>
        <span className="chip chip-outline">PENONTON</span>
        <span className="small mute">Belum masuk · host: {s.hostName}</span>
      </span>
      {s.status !== 'finished' && (
        <Link to={`/s/${s.slug}/gabung`} className="btn btn-primary btn-xs">
          Gabung
        </Link>
      )}
    </div>
  );
}

/** Jam main dari booking: sisa waktu, pengingat 10 menit, dan peringatan saat sudah lewat (sesi tetap berjalan). */
export function PlayTime({ s, isHost }: { s: Session; isHost: boolean }) {
  const now = useNow(1000);
  const start = new Date(s.start).getTime();
  const end = new Date(s.end).getTime();
  const roundN = currentRound(s)?.n ?? s.rounds.length;
  const dismissKey = `overtime.${s.slug}`;
  const [dismissedAt, setDismissedAt] = useState<number>(() => Number(auth.pref(dismissKey) ?? -1));

  if (s.status === 'finished') return null;
  const parts = [];
  if (s.bookingCancelled)
    parts.push(
      <div key="c" className="banner banner-danger">
        <Alert size={18} />
        <span>
          <b>Booking tidak ditemukan di Wins Court.</b> Mungkin dibatalkan atau diubah. Hubungi admin Wins Court.
        </span>
      </div>,
    );

  if (now < start) {
    parts.push(
      <div key="t" className="small mute">
        Mulai dalam {fmtDuration(start - now)}
      </div>,
    );
  } else if (now < end) {
    const left = end - now;
    const warn = left <= 10 * 60_000;
    parts.push(
      <div key="t" className="stack" style={{ gap: 6 }}>
        <div className="row-between small">
          <span className="mute">Jam main</span>
          <b className="num">Sisa {fmtDuration(left)}</b>
        </div>
        <div className={`timebar${warn ? ' warn' : ''}`}>
          <div style={{ width: `${Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))}%` }} />
        </div>
      </div>,
    );
    if (warn)
      parts.push(
        <div key="w" className="banner banner-warn">
          <Clock size={18} />
          <span>
            <b>Jam main tinggal {Math.ceil(left / 60_000)} menit.</b> Sesi boleh lanjut, tapi pastikan lapangan masih tersedia.
          </span>
        </div>,
      );
  } else if (s.status === 'running' || s.status === 'draft') {
    const show = !(isHost && dismissedAt >= roundN);
    parts.push(
      <div key="o" className="row-between small">
        <span className="mute">Lewat jam main</span>
        <b className="num" style={{ color: 'var(--danger)' }}>
          +{fmtDuration(now - end)}
        </b>
      </div>,
    );
    if (show)
      parts.push(
        <div key="b" className="banner banner-danger">
          <Alert size={18} />
          <span className="grow">
            <b>Jam main sudah habis sejak {fmtTime(s.end)}</b> — pastikan lapangan masih tersedia. Sesi tetap bisa berjalan.
          </span>
          {isHost && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => {
                auth.setPref(dismissKey, String(roundN));
                setDismissedAt(roundN);
              }}
            >
              Tutup
            </button>
          )}
        </div>,
      );
  }
  return <>{parts}</>;
}
