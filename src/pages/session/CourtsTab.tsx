import { useState } from 'react';
import { courtNow, currentRound, nextAppearance, roundDone } from '../../../shared/engine.ts';
import { formatInfo } from '../../../shared/formats.ts';
import { matchScore } from '../../../shared/standings.ts';
import type { Session } from '../../../shared/types.ts';
import { fmtTime } from '../../../shared/util.ts';
import { useNow } from '../../api.ts';
import { CourtArt } from '../../components/CourtArt.tsx';
import { Chevron, Lock, Plus, Shuffle } from '../../components/Icons.tsx';
import { Avatar, Sheet, useRun } from '../../components/ui.tsx';
import { courtName, isMine, nameOf, shortCourt, teamNames, type Ctx } from './helpers.ts';
import { MatchCard } from './MatchCard.tsx';
import { JoinCta, ShareCard } from './PlayersTab.tsx';
import { Summary } from './Summary.tsx';

const START_EARLY = 15 * 60_000;

export function CourtsTab({ ctx, onTab }: { ctx: Ctx; onTab: (t: string) => void }) {
  const { s } = ctx;
  if (s.status === 'draft') return <Lobby ctx={ctx} onTab={onTab} />;
  if (s.status === 'finished') return <Summary ctx={ctx} />;
  return <Live ctx={ctx} />;
}

function Lobby({ ctx, onTab }: { ctx: Ctx; onTab: (t: string) => void }) {
  const { s, isHost, role } = ctx;
  const now = useNow(5000);
  const { run, busy } = useRun();
  const active = s.players.filter((p) => p.status === 'active').length;
  const waiting = s.players.filter((p) => p.status === 'waitlist').length;
  const opensAt = new Date(s.start).getTime() - START_EARLY;
  const canStart = now >= opensAt;
  const info = formatInfo(s.format);
  return (
    <div className="stack">
      <div className="card hero stack">
        <CourtArt sport={s.sport} teamSize={s.teamSize} players={false} />
        <div className="row-between">
          <div>
            <div className="small mute">Menunggu pemain</div>
            <h2>{active} sudah siap</h2>
          </div>
          {waiting > 0 && (
            <button className="chip chip-warn" style={{ border: 0, cursor: 'pointer' }} onClick={() => onTab('players')}>
              {waiting} menunggu persetujuan
            </button>
          )}
        </div>
        {s.settings.levelBalance && <p className="tiny mute">Level aktif: tiap pertandingan, total level kedua tim dibuat setara.</p>}
        {info.fixedPairs && <p className="tiny mute">Format ini memakai pasangan tetap. Atur pasangan di tab Pemain.</p>}
        {info.clubs && <p className="tiny mute">Bagi pemain ke Klub A dan Klub B di tab Pemain.</p>}
        {isHost && (
          <>
            <button className="btn btn-primary btn-block" disabled={busy || !canStart} onClick={() => run(() => ctx.act({ type: 'start' }), 'Sesi dimulai')}>
              Mulai sesi
            </button>
            {!canStart && (
              <p className="tiny mute center">
                <Lock size={12} /> Tombol aktif pukul {fmtTime(new Date(opensAt).toISOString())}, 15 menit sebelum jam main.
              </p>
            )}
          </>
        )}
      </div>
      {role === 'viewer' && <JoinCta ctx={ctx} />}
      <ShareCard ctx={ctx} />
    </div>
  );
}

function Live({ ctx }: { ctx: Ctx }) {
  const { s, isHost, playerId } = ctx;
  const { run, busy } = useRun();
  const [manual, setManual] = useState(false);
  const cur = currentRound(s);
  const info = formatInfo(s.format);
  // Alur per lapangan: tiap lapangan menampilkan match yang sedang/akan dimainkan di sana.
  const nows = Array.from({ length: s.courts }, (_, c) => courtNow(s, c));
  const onCourt = new Set(nows.flatMap((n) => (n ? [n.match.id] : [])));
  const upcoming = s.rounds
    .filter((r) => !roundDone(r))
    .map((r) => ({ ...r, matches: r.matches.filter((m) => m.status !== 'done' && !onCourt.has(m.id)) }))
    .filter((r) => r.matches.length > 0);
  const playing = new Set(nows.flatMap((n) => (n ? [...n.match.a, ...n.match.b] : [])));
  const waiting = s.players.filter((p) => p.status === 'active' && !playing.has(p.id));
  const liveCount = nows.filter((n) => n && n.match.status === 'live').length;
  const past = s.rounds.filter((r) => roundDone(r)).reverse();
  const me = playerId ? nextAppearance(s, playerId) : null;
  const meP = s.players.find((p) => p.id === playerId);

  return (
    <div className="stack-lg">
      {meP && (
        <div className="banner banner-lime">
          <div>
            {meP.status === 'waitlist' ? (
              <>Kamu di waitlist. Tunggu host menyetujui.</>
            ) : me ? (
              me.inRounds === 0 ? (
                me.blockedBy?.length ? (
                  <>
                    <b>Kamu berikutnya</b> di {courtName(s, me.match.court)}, menunggu {me.blockedBy.map((id) => nameOf(s, id)).join(', ')} selesai.
                  </>
                ) : (
                  <>
                    <b>Kamu main sekarang</b> di {courtName(s, me.match.court)}.
                  </>
                )
              ) : (
                <>
                  Kamu main di <b>ronde {me.round.n}</b> ({me.inRounds} ronde lagi), {courtName(s, me.match.court)}.
                </>
              )
            ) : (
              <>Kamu belum ada di jadwal ronde yang tersusun.</>
            )}
          </div>
        </div>
      )}

      {cur ? (
        <section className="stack">
          <div className="row-between">
            <div>
              <div className="eyebrow">Sekarang</div>
              <h2>Di lapangan</h2>
            </div>
            <span className="chip">
              {liveCount > 0 && <span className="dot dot-live" />}
              {liveCount}/{s.courts} sedang main
            </span>
          </div>
          {s.courts > 1 && !info.dynamic && <p className="tiny mute">Lapangan yang selesai langsung lanjut ke match berikutnya, tanpa menunggu lapangan lain.</p>}
          {nows.map((n, c) =>
            n ? (
              <MatchCard key={n.match.id} ctx={ctx} m={n.match} roundN={n.round.n} blockedBy={n.blockedBy} />
            ) : (
              <div key={`empty${c}`} className="match done">
                <b className="small">{courtName(s, c)}</b>
                <p className="small mute">
                  {info.dynamic && !info.manual
                    ? 'Selesai. Menunggu lapangan lain, karena susunan berikutnya disusun dari hasil semua lapangan.'
                    : 'Tidak ada match terjadwal di lapangan ini.'}
                </p>
              </div>
            ),
          )}
          {waiting.length > 0 && (
            <div className="small">
              <span className="mute">Menunggu giliran: </span>
              {waiting.map((p) => p.name).join(', ')}
            </div>
          )}
        </section>
      ) : (
        <div className="card card-surface stack center">
          <p className="mute small">
            {info.manual
              ? 'Format Custom: susun ronde sendiri.'
              : info.bracket
                ? 'Turnamen selesai. Lihat peringkat, lalu akhiri sesi.'
                : 'Belum ada ronde. Pastikan pemain aktif cukup.'}
          </p>
        </div>
      )}

      {isHost && (
        <div className="row wrap">
          {!info.bracket && !info.manual && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => ctx.act({ type: 'regenerate' }), 'Ronde mendatang disusun ulang')}>
              <Shuffle size={16} /> Acak ulang
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setManual(true)}>
            <Plus size={16} /> Ronde manual
          </button>
          {cur && !info.dynamic && cur.matches.some((m) => m.status === 'scheduled') && cur.matches.some((m) => m.status !== 'scheduled') && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => ctx.act({ type: 'closeRound' }), 'Ronde ditutup')}>
              Tutup ronde
            </button>
          )}
        </div>
      )}

      {upcoming.length > 0 ? (
        <section className="stack">
          <div>
            <div className="eyebrow">Berikutnya</div>
            <h2>{upcoming.length} ronde ke depan</h2>
          </div>
          {upcoming.map((r, i) => (
            <UpcomingRound key={r.n} s={s} r={r} index={i} playerId={playerId} />
          ))}
        </section>
      ) : (
        info.dynamic &&
        !info.manual && (
          <p className="small mute center">
            {info.bracket ? 'Babak berikutnya disusun setelah pemenang diketahui.' : 'Ronde berikutnya disusun setelah ronde ini selesai, berdasarkan hasil.'}
          </p>
        )
      )}

      {past.length > 0 && <History s={s} rounds={past} />}
      {isHost && <ManualRound ctx={ctx} open={manual} onClose={() => setManual(false)} />}
    </div>
  );
}

/** Kartu ronde mendatang: tiap lapangan jadi kartu mini dengan avatar, ronde terdekat ditonjolkan. */
function UpcomingRound({ s, r, index, playerId }: { s: Session; r: Session['rounds'][number]; index: number; playerId: string | null }) {
  const mine = !!playerId && r.matches.some((m) => isMine(m, playerId));
  const restingMe = !!playerId && r.resting.includes(playerId);
  const team = (ids: string[], right?: boolean) => (
    <div className={`up-team${right ? ' right' : ''}`}>
      {ids.map((id) => {
        const p = s.players.find((x) => x.id === id);
        return (
          <div key={id} className={`up-player${id === playerId ? ' me' : ''}`}>
            {!right && <Avatar name={p?.name ?? '?'} gender={p?.gender} />}
            <span className="truncate">{p?.name ?? '?'}</span>
            {right && <Avatar name={p?.name ?? '?'} gender={p?.gender} />}
          </div>
        );
      })}
    </div>
  );
  return (
    <div className={`up-round rise${index === 0 ? ' next' : ''}${mine ? ' mine' : ''}`} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="up-head">
        <span className="up-no num">{r.n}</span>
        <div className="grow">
          <b>Ronde {r.n}</b>
          <div className="tiny mute">{index === 0 ? 'Main setelah ronde ini' : `${index + 1} ronde lagi`}</div>
        </div>
        {r.locked && <Lock size={14} />}
        {mine && <span className="chip chip-lime tiny">Kamu main</span>}
        {restingMe && <span className="chip tiny">Kamu istirahat</span>}
        {index === 0 && !mine && !restingMe && <span className="chip chip-dark tiny">Berikutnya</span>}
      </div>
      <div className="up-matches">
        {r.matches.map((m) => (
          <div key={m.id} className={`up-match${isMine(m, playerId) ? ' me' : ''}`}>
            <div className="up-court">
              <span className={`up-court-badge ${s.sport}`}>{shortCourt(s, m.court)}</span>
              {m.stage && <span className="tiny mute">{m.stage}</span>}
            </div>
            <div className="up-teams">
              {team(m.a)}
              <span className="up-vs">VS</span>
              {team(m.b, true)}
            </div>
          </div>
        ))}
      </div>
      {r.resting.length > 0 && (
        <div className="up-rest">
          <span className="tiny mute">Istirahat</span>
          <div className="up-rest-list">
            {r.resting.map((id) => (
              <span key={id} className={`chip tiny${id === playerId ? ' chip-lime' : ''}`}>
                {nameOf(s, id)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function History({ s, rounds }: { s: Session; rounds: Session['rounds'] }) {
  return (
    <details className="adv card card-tight">
      <summary>
        Riwayat ({rounds.length} ronde) <Chevron size={18} className="chev" />
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {rounds.map((r) => (
          <div key={r.n} className="upcoming">
            <b className="small">Ronde {r.n}</b>
            {r.matches.map((m) => {
              const sc = matchScore(s, m);
              return (
                <div key={m.id} className="line">
                  <span className="court">{shortCourt(s, m.court)}</span>
                  <span className="grow">
                    <span style={sc.winner === 'a' ? { fontWeight: 700 } : undefined}>{teamNames(s, m.a)}</span>
                    <span className="mute"> vs </span>
                    <span style={sc.winner === 'b' ? { fontWeight: 700 } : undefined}>{teamNames(s, m.b)}</span>
                  </span>
                  <b className="num">
                    {sc.a}-{sc.b}
                  </b>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </details>
  );
}

function ManualRound({ ctx, open, onClose }: { ctx: Ctx; open: boolean; onClose: () => void }) {
  const { s } = ctx;
  const size = s.teamSize;
  const blank = () => Array.from({ length: s.courts }, (_, c) => ({ court: c, a: Array(size).fill(''), b: Array(size).fill('') }));
  const [rows, setRows] = useState(blank);
  const { run, busy } = useRun();
  const active = s.players.filter((p) => p.status === 'active');
  const used = new Set(rows.flatMap((r) => [...r.a, ...r.b]).filter(Boolean));
  const set = (ci: number, team: 'a' | 'b', i: number, id: string) =>
    setRows((prev) => prev.map((r, k) => (k === ci ? { ...r, [team]: r[team].map((x: string, j: number) => (j === i ? id : x)) } : r)));
  return (
    <Sheet open={open} onClose={onClose} title="Ronde manual">
      <p className="small mute">Pilih pemain per lapangan. Lapangan yang tidak lengkap dilewati.</p>
      {rows.map((r, ci) => (
        <div key={ci} className="card card-surface card-tight stack" style={{ gap: 8 }}>
          <b className="small">{courtName(s, ci)}</b>
          {(['a', 'b'] as const).map((team) => (
            <div key={team} className="row">
              <span className="tiny mute" style={{ width: 40 }}>
                Tim {team.toUpperCase()}
              </span>
              {r[team].map((id: string, i: number) => (
                <select key={i} className="select" value={id} onChange={(e) => set(ci, team, i, e.target.value)}>
                  <option value="">—</option>
                  {active.map((p) => (
                    <option key={p.id} value={p.id} disabled={used.has(p.id) && p.id !== id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          ))}
        </div>
      ))}
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await ctx.act({ type: 'manualRound', matches: rows });
            setRows(blank());
            onClose();
          }, 'Ronde ditambahkan')
        }
      >
        Tambah ronde
      </button>
    </Sheet>
  );
}
