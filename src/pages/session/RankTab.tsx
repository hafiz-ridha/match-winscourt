import { groupTables } from '../../../shared/engine.ts';
import { formatInfo } from '../../../shared/formats.ts';
import { clubTotals, playerStandings, teamStandings, unitsOf } from '../../../shared/standings.ts';
import type { Session, Standing } from '../../../shared/types.ts';
import { Lock, Trophy } from '../../components/Icons.tsx';
import type { Ctx } from './helpers.ts';

export function StandingsTable({ list, mine, showComp, title }: { list: Standing[]; mine?: string | null; showComp: boolean; title?: string }) {
  const hasBonus = list.some((x) => x.bonus > 0);
  return (
    <div className="card card-tight">
      {title && <h3 style={{ marginBottom: 6 }}>{title}</h3>}
      <table className="table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>#</th>
            <th>Nama</th>
            <th title="Main">M</th>
            <th title="Menang-Seri-Kalah">M-S-K</th>
            <th title="Poin dicetak">Poin</th>
            {hasBonus && <th title="Bonus lapangan atas">Bonus</th>}
            {showComp && <th title="Kompensasi">+M</th>}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={x.id} className={`${i === 0 && x.played > 0 ? 'top1' : ''}${x.id === mine ? ' mine' : ''}`}>
              <td className="rank">{i + 1}</td>
              <td>
                <span className="truncate" style={{ display: 'inline-block', maxWidth: 130, verticalAlign: 'bottom' }}>
                  {x.name}
                </span>
                {x.guest && <span className="chip tiny" style={{ marginLeft: 4 }}>Tamu</span>}
              </td>
              <td>{x.played}</td>
              <td className="tiny">
                {x.won}-{x.draw}-{x.lost}
              </td>
              <td>{x.pf}</td>
              {hasBonus && <td>{x.bonus}</td>}
              {showComp && <td className="mute">{x.comp ? `+${x.comp}` : '–'}</td>}
              <td className="total">{x.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bracket({ s }: { s: Session }) {
  const units = new Map(unitsOf(s).map((u) => [u.id, u.name]));
  const ko = (s.bracket?.matches ?? []).filter((m) => !m.stage.startsWith('Grup'));
  const stages = [...new Set(ko.map((m) => m.stage))];
  if (!stages.length) return null;
  return (
    <div className="card card-tight stack">
      <h3>Bagan gugur</h3>
      {stages.map((st) => (
        <div key={st} className="upcoming">
          <b className="small">{st}</b>
          {ko
            .filter((m) => m.stage === st)
            .map((m) => (
              <div key={m.id} className="line">
                <span className="grow">
                  <span style={m.winner && m.winner === m.unitA ? { fontWeight: 700, color: 'var(--lime-deep)' } : undefined}>{m.unitA ? units.get(m.unitA) : '—'}</span>
                  <span className="mute"> vs </span>
                  <span style={m.winner && m.winner === m.unitB ? { fontWeight: 700, color: 'var(--lime-deep)' } : undefined}>
                    {m.unitB ? units.get(m.unitB) : m.unitA ? 'bye' : '—'}
                  </span>
                </span>
                {m.winner && <Trophy size={14} />}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export function RankTab({ ctx }: { ctx: Ctx }) {
  const { s, isHost, playerId } = ctx;
  const info = formatInfo(s.format);
  const hidden = s.settings.hideLeaderboard && !isHost && s.status !== 'finished';
  if (hidden)
    return (
      <div className="card stack center">
        <Lock size={28} style={{ margin: '0 auto', color: 'var(--mute)' }} />
        <h3>Peringkat disembunyikan</h3>
        <p className="small mute">Host menyembunyikan peringkat. Hasil akan muncul setelah sesi selesai.</p>
      </div>
    );
  const players = playerStandings(s);
  const clubs = info.clubs ? clubTotals(s) : null;
  return (
    <div className="stack-lg">
      {s.settings.hideLeaderboard && isHost && <div className="banner banner-warn">Peringkat disembunyikan dari pemain sampai sesi selesai.</div>}
      {clubs && (
        <div className="card hero stack">
          <div className="eyebrow">Club vs Club</div>
          <div className="row-between">
            <div>
              <div className="small mute">Klub A</div>
              <div className="bignum" style={{ fontSize: 48 }}>
                {clubs.A}
              </div>
              <div className="tiny mute">{clubs.winsA} kemenangan</div>
            </div>
            <span className="mute">vs</span>
            <div style={{ textAlign: 'right' }}>
              <div className="small mute">Klub B</div>
              <div className="bignum" style={{ fontSize: 48 }}>
                {clubs.B}
              </div>
              <div className="tiny mute">{clubs.winsB} kemenangan</div>
            </div>
          </div>
        </div>
      )}
      {s.format === 'group_ko' &&
        groupTables(s).map((g) => {
          const names = new Map(unitsOf(s).map((u) => [u.id, u.name]));
          return (
            <div key={g.name} className="card card-tight">
              <h3 style={{ marginBottom: 6 }}>{g.name}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th>Tim</th>
                    <th>Menang</th>
                    <th>Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={r.id} className={i < 2 ? 'top1' : ''}>
                      <td className="rank">{i + 1}</td>
                      <td>{names.get(r.id)}</td>
                      <td>{r.won}</td>
                      <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      {info.bracket && <Bracket s={s} />}
      {info.fixedPairs && s.teamSize === 2 && <StandingsTable title="Peringkat tim" list={teamStandings(s)} showComp={false} />}
      <StandingsTable title={info.fixedPairs ? 'Peringkat individu' : undefined} list={players} mine={playerId} showComp={s.settings.compensation} />
      <p className="tiny mute">
        Urutan: {s.settings.sortBy === 'wins' ? 'menang' : 'total poin'} → menang → selisih poin → poin dicetak.
        {s.settings.compensation && ' +M = kompensasi untuk pemain yang main lebih sedikit.'}
      </p>
    </div>
  );
}
