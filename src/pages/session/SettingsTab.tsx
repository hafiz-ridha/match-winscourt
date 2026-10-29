import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatInfo, formatsFor, isManualBooking, MANUAL_RETENTION_DAYS, manualExpiry } from '../../../shared/formats.ts';
import type { FormatId, ScoreRules, SessionSettings } from '../../../shared/types.ts';
import { fmtDate, fmtTime } from '../../../shared/util.ts';
import { api } from '../../api.ts';
import { Download, Lock, Tv } from '../../components/Icons.tsx';
import { RulesEditor, SettingsEditor } from '../../components/RulesEditor.tsx';
import { Seg, Sheet, useRun } from '../../components/ui.tsx';
import { exportCsv, type Ctx } from './helpers.ts';

export function SettingsTab({ ctx }: { ctx: Ctx }) {
  const { s } = ctx;
  const nav = useNavigate();
  const { run, busy } = useRun();
  const [name, setName] = useState(s.name);
  const [rules, setRules] = useState<ScoreRules>(s.rules);
  const [settings, setSettings] = useState<SessionSettings>(s.settings);
  const [maxPlayers, setMaxPlayers] = useState(s.maxPlayers ? String(s.maxPlayers) : '');
  const [format, setFormat] = useState<FormatId>(s.format);
  const [teamSize, setTeamSize] = useState<1 | 2>(s.teamSize);
  const [confirm, setConfirm] = useState<'finish' | 'delete' | null>(null);

  useEffect(() => {
    setRules(s.rules);
    setSettings(s.settings);
  }, [s.rules, s.settings]);

  const draft = s.status === 'draft';
  const dirty =
    name !== s.name ||
    JSON.stringify(rules) !== JSON.stringify(s.rules) ||
    JSON.stringify(settings) !== JSON.stringify(s.settings) ||
    (maxPlayers ? Number(maxPlayers) : null) !== s.maxPlayers ||
    format !== s.format ||
    teamSize !== s.teamSize;

  const save = () =>
    run(
      () =>
        ctx.act({
          type: 'settings',
          name,
          rules,
          settings,
          maxPlayers: maxPlayers ? Number(maxPlayers) : null,
          ...(draft ? { format, teamSize } : {}),
        }),
      'Pengaturan disimpan',
    );

  return (
    <div className="stack-lg">
      <div className="card card-surface stack small" style={{ gap: 6 }}>
        <div className="row">
          <Lock size={14} /> <b>{s.bookingId.startsWith('MANUAL-') ? 'Sesi manual (tanpa booking Wins Court)' : `Dari booking Wins Court ${s.bookingId}`}</b>
        </div>
        <span className="mute">
          {fmtDate(s.start)} · {fmtTime(s.start)}–{fmtTime(s.end)} · {s.courtNames.join(', ')}
        </span>
        {isManualBooking(s.bookingId) && (
          <span className="tiny mute">
            Data pertandingan sesi ini disimpan sampai {fmtDate(manualExpiry(s.end))} ({MANUAL_RETENTION_DAYS} hari setelah jam main), lalu dihapus otomatis.
          </span>
        )}
      </div>

      <div className="card stack">
        <label className="field">
          <span className="label">Nama sesi</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <div className="field">
          <span className="label">Mode</span>
          {draft ? (
            <div className="choice-grid">
              {formatsFor(s.sport, s.courts).map((f) => (
                <button key={f.id} type="button" className={`choice${f.id === format ? ' on' : ''}`} onClick={() => setFormat(f.id)}>
                  <b>{f.name}</b>
                  <span>{f.desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="small">
              <b>{formatInfo(s.format).name}</b> <span className="mute">· tidak bisa diubah setelah sesi dimulai</span>
            </div>
          )}
        </div>
        {draft && s.sport === 'badminton' && !formatInfo(format).mixed && (
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
        <RulesEditor sport={s.sport} rules={rules} onChange={setRules} />
        <label className="field">
          <span className="label">Batas pemain</span>
          <input className="input" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value.replace(/\D/g, ''))} placeholder="Tanpa batas" inputMode="numeric" />
          <span className="hint">Menurunkan batas tidak mengeluarkan pemain yang sudah terdaftar.</span>
        </label>
        <SettingsEditor format={draft ? format : s.format} settings={settings} onChange={setSettings} />
        <button className="btn btn-primary btn-block" disabled={busy || !dirty} onClick={save}>
          Simpan pengaturan
        </button>
      </div>

      <div className="card stack">
        <h3>Alat</h3>
        <a className="btn btn-ghost btn-block" href={`/s/${s.slug}/tv`} target="_blank" rel="noreferrer">
          <Tv size={18} /> Buka papan skor TV
        </a>
        <button className="btn btn-ghost btn-block" onClick={() => exportCsv(s)}>
          <Download size={18} /> Unduh CSV
        </button>
      </div>

      <div className="card stack">
        <h3>Sesi</h3>
        {s.status === 'running' && (
          <button className="btn btn-dark btn-block" onClick={() => setConfirm('finish')}>
            Selesai sesi
          </button>
        )}
        {s.status === 'finished' && (
          <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(() => ctx.act({ type: 'reopen' }), 'Sesi dibuka lagi')}>
            Buka lagi sesi
          </button>
        )}
        <button className="btn btn-danger btn-block" onClick={() => setConfirm('delete')}>
          Hapus sesi
        </button>
      </div>

      <Sheet open={confirm === 'finish'} onClose={() => setConfirm(null)} title="Selesaikan sesi?">
        <p className="small mute">Peringkat dan ringkasan menjadi final. Ronde yang belum dimainkan dibuang. Kamu masih bisa membuka lagi nanti.</p>
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await ctx.act({ type: 'finish' });
              setConfirm(null);
            }, 'Sesi selesai')
          }
        >
          Ya, selesai
        </button>
      </Sheet>
      <Sheet open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Hapus sesi?">
        <p className="small mute">Semua pemain, skor, dan peringkat sesi ini terhapus permanen. Booking di Wins Court tidak terpengaruh.</p>
        <button
          className="btn btn-danger btn-block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.remove(s.slug);
              nav('/', { replace: true });
            }, 'Sesi dihapus')
          }
        >
          Hapus permanen
        </button>
      </Sheet>
    </div>
  );
}
