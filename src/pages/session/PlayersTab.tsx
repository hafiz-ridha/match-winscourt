import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Link } from 'react-router-dom';
import { formatInfo, LEVELS, levelName } from '../../../shared/formats.ts';
import { playerStandings } from '../../../shared/standings.ts';
import type { Gender, Level, Player, PlayerStatus } from '../../../shared/types.ts';
import { Plus, Share, Tv, Users, Whistle } from '../../components/Icons.tsx';
import { Avatar, copyText, LevelBars, Seg, Sheet, Switch, useRun, useToast } from '../../components/ui.tsx';
import { refereeUrl, sessionUrl, type Ctx } from './helpers.ts';

const STATUS_LABEL: Record<PlayerStatus, string> = {
  waitlist: 'Menunggu',
  active: 'Aktif',
  rest: 'Istirahat',
  late: 'Terlambat',
  left: 'Pulang',
};

export function ShareCard({ ctx }: { ctx: Ctx }) {
  const { s, isHost } = ctx;
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const url = sessionUrl(s);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0E1714', light: '#FFFFFF' } }).then(setQr).catch(() => {});
  }, [url]);
  const [showQr, setShowQr] = useState(false);
  const share = async () => {
    const text = `Gabung ${s.name} di Wins Court: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: s.name, text, url });
        return;
      } catch {
        /* dibatalkan */
      }
    }
    if (await copyText(url)) toast('Link disalin');
  };
  return (
    <div className="card stack">
      <div className="row-between">
        <div>
          <h3>Bagikan link sesi</h3>
          <p className="tiny mute">Agar pemain bisa daftar dan melihat jadwal & skor.</p>
        </div>
        <button className="icon-btn" onClick={() => setShowQr((v) => !v)} aria-label="Tampilkan QR">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4" />
          </svg>
        </button>
      </div>
      {showQr && qr && <img src={qr} alt="QR link sesi" style={{ width: 200, height: 200, alignSelf: 'center', borderRadius: 16 }} />}
      <div className="row">
        <input className="input small" readOnly value={url.replace(/^https?:\/\//, '')} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={share} aria-label="Bagikan">
          <Share size={18} />
        </button>
      </div>
      {isHost && (
        <div className="row wrap">
          <button className="btn btn-ghost btn-sm" onClick={async () => (await copyText(refereeUrl(s))) && toast('Link wasit disalin. Hanya untuk wasit!')}>
            <Whistle size={16} /> Salin link wasit
          </button>
          <a className="btn btn-ghost btn-sm" href={`/s/${s.slug}/tv`} target="_blank" rel="noreferrer">
            <Tv size={16} /> Papan skor TV
          </a>
        </div>
      )}
    </div>
  );
}

/** Ajakan gabung untuk penerima link yang belum masuk. */
export function JoinCta({ ctx }: { ctx: Ctx }) {
  const { s } = ctx;
  if (s.status === 'finished') return null;
  return (
    <div className="card hero stack">
      <div>
        <h3>Main di sesi ini?</h3>
        <p className="small mute">Pilih namamu atau daftar baru. Kamu bisa lihat jadwal mainmu setelah masuk.</p>
      </div>
      <Link to={`/s/${s.slug}/gabung`} className="btn btn-primary btn-block">
        Gabung / masuk sebagai pemain
      </Link>
    </div>
  );
}

export function PlayersTab({ ctx }: { ctx: Ctx }) {
  const { s, isHost, role, playerId } = ctx;
  const { run, busy } = useRun();
  const [edit, setEdit] = useState<Player | null>(null);
  const [adding, setAdding] = useState(false);
  const info = formatInfo(s.format);
  const played = useMemo(() => new Map(playerStandings(s).map((x) => [x.id, x.played])), [s]);
  const waitlist = s.players.filter((p) => p.status === 'waitlist');
  const others = s.players.filter((p) => p.status !== 'waitlist');
  const byLevel = LEVELS.map((l) => ({ ...l, list: others.filter((p) => p.level === l.v && p.status !== 'left') })).filter((g) => g.list.length);
  const left = others.filter((p) => p.status === 'left');
  const me = s.players.find((p) => p.id === playerId);
  const pairs = useMemo(() => {
    const m = new Map<string, Player[]>();
    for (const p of s.players) if (p.pair && p.status !== 'left') m.set(p.pair, [...(m.get(p.pair) ?? []), p]);
    return [...m.values()];
  }, [s.players]);

  return (
    <div className="stack-lg">
      {role === 'viewer' && <JoinCta ctx={ctx} />}
      {me && (
        <div className="banner banner-lime">
          <span>
            Kamu terdaftar sebagai <b>{me.name}</b> · {STATUS_LABEL[me.status]} · {levelName(me.level)}
          </span>
        </div>
      )}
      <ShareCard ctx={ctx} />

      {isHost && (
        <button className="btn btn-dark btn-block" onClick={() => setAdding(true)}>
          <Plus size={18} /> Tambah pemain
        </button>
      )}

      {waitlist.length > 0 && (
        <section className="card stack">
          <div className="row-between">
            <h3>Waitlist · {waitlist.length}</h3>
            {isHost && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => ctx.act({ type: 'approveAll' }), 'Semua disetujui')}>
                Setujui semua
              </button>
            )}
          </div>
          {s.maxPlayers && <p className="tiny mute">Batas {s.maxPlayers} pemain · {others.filter((p) => p.status !== 'left').length} sudah masuk.</p>}
          <div className="plist">
            {waitlist.map((p) => (
              <div key={p.id} className="prow">
                <Avatar name={p.name} gender={p.gender} />
                <div className="grow">
                  <b className="small">{p.name}</b>
                  <div className="tiny mute">
                    {levelName(p.level)} · {p.gender === 'F' ? 'Putri' : 'Putra'}
                  </div>
                </div>
                {isHost && (
                  <>
                    <button className="btn btn-ghost btn-xs" onClick={() => setEdit(p)}>
                      Atur
                    </button>
                    <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => run(() => ctx.act({ type: 'approve', id: p.id }))}>
                      Setujui
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {isHost && info.fixedPairs && s.teamSize === 2 && (
        <section className="card stack">
          <div className="row-between">
            <h3>Pasangan tetap · {pairs.filter((x) => x.length === 2).length}</h3>
            <div className="row">
              {s.status === 'draft' && pairs.length > 0 && (
                <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => ctx.act({ type: 'clearPairs' }))}>
                  Reset
                </button>
              )}
              <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => run(() => ctx.act({ type: 'autoPairs' }), 'Pasangan dibuat')}>
                Pasangkan otomatis
              </button>
            </div>
          </div>
          <p className="tiny mute">Otomatis: level tertinggi dipasangkan dengan terendah. Ubah lewat tombol Atur di tiap pemain.</p>
          {pairs.map((pr, i) => (
            <div key={i} className="small row-between">
              <span>
                <b className="num mute">{i + 1}.</b> {pr.map((p) => p.name).join(' / ')}
              </span>
              {pr.length < 2 && <span className="chip chip-warn tiny">belum lengkap</span>}
            </div>
          ))}
        </section>
      )}

      {isHost && info.clubs && (
        <section className="card stack">
          <div className="row-between">
            <h3>Klub</h3>
            <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => run(() => ctx.act({ type: 'autoClubs' }), 'Klub dibagi')}>
              Bagi otomatis
            </button>
          </div>
          <div className="row small">
            <span className="chip chip-lime">Klub A · {s.players.filter((p) => p.club === 'A' && p.status === 'active').length}</span>
            <span className="chip chip-mint">Klub B · {s.players.filter((p) => p.club === 'B' && p.status === 'active').length}</span>
          </div>
        </section>
      )}

      {byLevel.map((g) => (
        <section key={g.v} className="card stack" style={{ gap: 4 }}>
          <div className="row-between">
            <h3>
              Kelas {g.v} · {g.name}
            </h3>
            <span className="tiny mute">{g.list.length} pemain</span>
          </div>
          <div className="plist">
            {g.list.map((p) => (
              <PlayerRow key={p.id} p={p} played={played.get(p.id) ?? 0} mine={p.id === playerId} clubs={!!info.clubs} onEdit={isHost ? () => setEdit(p) : undefined} />
            ))}
          </div>
        </section>
      ))}
      {others.length === 0 && waitlist.length === 0 && (
        <div className="card card-surface center stack">
          <Users size={28} style={{ margin: '0 auto', color: 'var(--mute)' }} />
          <p className="small mute">Belum ada pemain. Bagikan link atau tambahkan nama.</p>
        </div>
      )}
      {left.length > 0 && <p className="tiny mute">Sudah pulang: {left.map((p) => p.name).join(', ')}</p>}

      {isHost && <AddPlayers ctx={ctx} open={adding} onClose={() => setAdding(false)} />}
      {isHost && edit && <EditPlayer ctx={ctx} p={s.players.find((x) => x.id === edit.id) ?? edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PlayerRow({ p, played, mine, clubs, onEdit }: { p: Player; played: number; mine: boolean; clubs: boolean; onEdit?: () => void }) {
  return (
    <div className="prow" style={mine ? { background: 'rgba(198,255,61,0.14)', borderRadius: 12, padding: '10px 6px' } : undefined}>
      <Avatar name={p.name} gender={p.gender} />
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <b className="small truncate">{p.name}</b>
          {p.guest && <span className="chip tiny">Tamu</span>}
          {clubs && p.club && <span className={`chip tiny ${p.club === 'A' ? 'chip-lime' : 'chip-mint'}`}>{p.club}</span>}
        </div>
        <div className="row tiny mute" style={{ gap: 6 }}>
          <LevelBars level={p.level} />
          <span>{p.gender === 'F' ? '♀' : '♂'}</span>
          <span>· {played} main</span>
        </div>
      </div>
      {p.status !== 'active' && <span className={`chip tiny ${p.status === 'left' ? '' : 'chip-warn'}`}>{STATUS_LABEL[p.status]}</span>}
      {onEdit && (
        <button className="btn btn-ghost btn-xs" onClick={onEdit}>
          Atur
        </button>
      )}
    </div>
  );
}

function AddPlayers({ ctx, open, onClose }: { ctx: Ctx; open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [gender, setGender] = useState<Gender>('M');
  const [level, setLevel] = useState<Level>(1);
  const { run, busy } = useRun();
  const names = text
    .split(/\n|,/)
    .map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  return (
    <Sheet open={open} onClose={onClose} title="Tambah pemain">
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Satu nama per baris.\nBisa tempel daftar dari WhatsApp: "1. Ayu"'} autoFocus />
      <div className="field">
        <span className="label">Gender default</span>
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
        <span className="label">Level default</span>
        <Seg value={level} onChange={(v) => setLevel(v as Level)} options={LEVELS.map((l) => ({ v: l.v as Level, label: l.name }))} />
      </div>
      <p className="hint">Pemain yang ditambahkan host langsung aktif. Mereka bisa mengklaim namanya lewat link dengan PIN.</p>
      <button
        className="btn btn-primary btn-block"
        disabled={busy || !names.length}
        onClick={() =>
          run(async () => {
            await ctx.act({ type: 'addPlayers', names, gender, level });
            setText('');
            onClose();
          }, `${names.length} pemain ditambahkan`)
        }
      >
        Tambah {names.length || ''} pemain
      </button>
    </Sheet>
  );
}

function EditPlayer({ ctx, p, onClose }: { ctx: Ctx; p: Player; onClose: () => void }) {
  const { s } = ctx;
  const { run, busy } = useRun();
  const info = formatInfo(s.format);
  const [name, setName] = useState(p.name);
  const patch = (x: Record<string, unknown>) => run(() => ctx.act({ type: 'updatePlayer', id: p.id, patch: x }));
  const partners = s.players.filter((o) => o.id !== p.id && o.status !== 'left' && o.status !== 'waitlist');
  const partner = p.pair ? s.players.find((o) => o.id !== p.id && o.pair === p.pair) : undefined;
  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div className="row">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn btn-ghost" disabled={busy || name.trim() === p.name} onClick={() => patch({ name })}>
          Ubah
        </button>
      </div>
      <div className="field">
        <span className="label">Status kehadiran</span>
        <div className="minichips">
          {(['active', 'rest', 'late', 'left', 'waitlist'] as PlayerStatus[]).map((st) => (
            <button key={st} className={p.status === st ? 'on' : ''} disabled={busy} onClick={() => patch({ status: st })}>
              {STATUS_LABEL[st]}
            </button>
          ))}
        </div>
        <span className="hint">Istirahat/Terlambat/Pulang dilewati saat menyusun ronde berikutnya. Ronde berjalan tidak terganggu.</span>
      </div>
      <div className="field">
        <span className="label">Level</span>
        <Seg value={p.level} onChange={(v) => patch({ level: v })} options={LEVELS.map((l) => ({ v: l.v as Level, label: l.name }))} />
      </div>
      <div className="field">
        <span className="label">Gender</span>
        <Seg
          value={p.gender}
          onChange={(v) => patch({ gender: v })}
          options={[
            { v: 'M', label: '♂ Putra' },
            { v: 'F', label: '♀ Putri' },
          ]}
        />
      </div>
      {info.fixedPairs && s.teamSize === 2 && (
        <label className="field">
          <span className="label">Pasangan tetap</span>
          <select
            className="select"
            value={partner?.id ?? ''}
            onChange={(e) =>
              run(async () => {
                const other = e.target.value;
                const pairId = other ? Math.random().toString(36).slice(2, 8) : '';
                if (partner) await ctx.act({ type: 'updatePlayer', id: partner.id, patch: { pair: '' } });
                if (other) {
                  const otherP = s.players.find((x) => x.id === other);
                  const otherPartner = otherP?.pair ? s.players.find((x) => x.id !== other && x.pair === otherP.pair) : undefined;
                  if (otherPartner) await ctx.act({ type: 'updatePlayer', id: otherPartner.id, patch: { pair: '' } });
                  await ctx.act({ type: 'updatePlayer', id: other, patch: { pair: pairId } });
                }
                await ctx.act({ type: 'updatePlayer', id: p.id, patch: { pair: pairId } });
              })
            }
          >
            <option value="">— belum berpasangan —</option>
            {partners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.pair && o.id !== partner?.id ? ' (sudah berpasangan)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {info.clubs && (
        <div className="field">
          <span className="label">Klub</span>
          <Seg
            value={p.club ?? 'A'}
            onChange={(v) => patch({ club: v })}
            options={[
              { v: 'A', label: 'Klub A' },
              { v: 'B', label: 'Klub B' },
            ]}
          />
        </div>
      )}
      <Switch label="Tamu" hint="Ditandai sebagai tamu di peringkat." on={!!p.guest} onChange={(v) => patch({ guest: v })} />
      {p.hasPin && (
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(() => ctx.act({ type: 'resetPin', id: p.id }), 'PIN direset. Pemain bisa membuat PIN baru lewat "Ini aku".')}>
          Reset PIN
        </button>
      )}
      <button
        className="btn btn-danger btn-block"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await ctx.act({ type: 'removePlayer', id: p.id });
            onClose();
          }, 'Pemain dikeluarkan')
        }
      >
        Keluarkan dari sesi
      </button>
      <button className="btn btn-ghost btn-block" onClick={onClose}>
        Selesai
      </button>
    </Sheet>
  );
}
