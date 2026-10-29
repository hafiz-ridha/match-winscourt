import { Link } from 'react-router-dom';
import { formatInfo, rulesLabel } from '../../../shared/formats.ts';
import { fmtDate, fmtTime } from '../../../shared/util.ts';
import { auth } from '../../api.ts';
import { Clock, Court, Trophy, Users } from '../../components/Icons.tsx';
import { SportChip } from '../../components/ui.tsx';
import type { Ctx } from './helpers.ts';

/** Aturan sesi untuk pemain (hanya baca). Pengaturan hanya bisa diubah host. */
export function RulesTab({ ctx }: { ctx: Ctx }) {
  const { s, playerId } = ctx;
  const info = formatInfo(s.format);
  const r = s.rules;
  const me = s.players.find((p) => p.id === playerId);

  const scoring: string[] = [];
  if (r.kind === 'rally') {
    scoring.push(`Rally point: setiap reli = 1 poin untuk pemenang reli.`);
    scoring.push(`Menang di ${r.target} poin dengan selisih 2. Jika belum selisih 2, reli lanjut.`);
    scoring.push('1 game per match. Wasit bisa mengubah target poin saat main.');
  } else if (r.kind === 'points') {
    scoring.push(r.target > 0 ? `Poin langsung: match selesai saat total poin kedua tim = ${r.target} (contoh ${Math.ceil(r.target / 2) + 1}–${Math.floor(r.target / 2) - 1}).` : 'Poin langsung tanpa batas; host/wasit yang mengakhiri match.');
    scoring.push(`Servis bergantian tiap ${r.serveEvery} poin.`);
  } else {
    scoring.push(
      r.kind === 'games'
        ? r.gamesMode === 'race'
          ? `Tim pertama yang mencapai ${r.games} game menang.`
          : `Match selesai setelah ${r.games} game dimainkan. Bisa seri.`
        : 'Best of 3 set: set sampai 6 game (selisih 2), tie-break di 6-6, super tie-break sampai 10 di set penentu.',
    );
    scoring.push(
      r.deuce === 'golden'
        ? 'Di 40-40: golden point, poin berikutnya menang game.'
        : r.deuce === 'advantage'
          ? 'Di 40-40: advantage, harus unggul 2 poin.'
          : 'Di 40-40: star point, dua kali advantage lalu deuce ketiga jadi golden point.',
    );
  }

  return (
    <div className="stack-lg">
      <div className="card hero stack">
        <div className="row-between">
          <SportChip sport={s.sport} />
          <span className="chip">{info.name}</span>
        </div>
        <p className="small">{info.desc}</p>
      </div>

      <section className="card stack">
        <div className="row">
          <Trophy size={18} />
          <h3>Skor</h3>
        </div>
        <b className="small">{rulesLabel(r)}</b>
        <ul className="small mute" style={{ margin: 0, paddingLeft: 18 }}>
          {scoring.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        <div className="row">
          <Court size={18} />
          <h3>Lapangan</h3>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {s.courtNames.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
        <p className="small mute">
          {s.courts} lapangan · {s.teamSize === 1 ? 'tunggal (1 lawan 1)' : 'ganda (2 lawan 2)'}{s.bookingId.startsWith('MANUAL-') ? '' : ' · Wins Court, Maguwoharjo'}
        </p>
      </section>

      <section className="card stack">
        <div className="row">
          <Clock size={18} />
          <h3>Jam main</h3>
        </div>
        <p className="small">
          <b>{fmtDate(s.start)}</b> · {fmtTime(s.start)}–{fmtTime(s.end)}
        </p>
        <p className="small mute">Sesi boleh berjalan melewati jam main. Akan ada peringatan saat jam main habis.</p>
      </section>

      <section className="card stack">
        <div className="row">
          <Users size={18} />
          <h3>Pemain & pertandingan</h3>
        </div>
        <ul className="small mute" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Daftar lewat link sesi, lalu tunggu host menyetujui.{s.maxPlayers ? ` Batas ${s.maxPlayers} pemain.` : ''}</li>
          <li>Susunan dibuat otomatis: yang paling sedikit main dan paling lama menunggu didahulukan.</li>
          {s.settings.levelBalance && <li>Level dua tim dibuat setara di setiap pertandingan.</li>}
          {info.mixed && <li>Setiap tim terdiri dari 1 putra dan 1 putri.</li>}
          {info.fixedPairs && <li>Kamu bermain dengan pasangan tetap yang diatur host.</li>}
          {info.clubs && <li>Pemain dibagi ke Klub A dan Klub B; skor dijumlah per klub.</li>}
          {s.format === 'winner_stays' && <li>Tim menang bertahan di lapangan maksimal {s.settings.maxWinStreak} kali berturut.</li>}
          {s.format === 'koth' && <li>Menang naik lapangan, kalah turun. Lapangan atas memberi poin bonus.</li>}
          <li>
            Peringkat diurutkan berdasarkan {s.settings.sortBy === 'wins' ? 'jumlah menang' : 'total poin'}
            {s.settings.compensation ? ', dengan kompensasi +M untuk pemain yang main lebih sedikit' : ''}.
          </li>
          {s.settings.hideLeaderboard && <li>Peringkat disembunyikan sampai sesi selesai.</li>}
        </ul>
        <p className="tiny mute">Hanya host yang bisa mengubah aturan, pemain, dan susunan pertandingan.</p>
      </section>

      {me ? (
        <div className="card card-surface row-between">
          <span className="small">
            Masuk sebagai <b>{me.name}</b>
          </span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => {
              auth.clearPlayer(s.slug);
              location.reload();
            }}
          >
            Bukan kamu? Keluar
          </button>
        </div>
      ) : (
        s.status !== 'finished' && (
          <Link to={`/s/${s.slug}/gabung`} className="btn btn-primary btn-block">
            Gabung sebagai pemain
          </Link>
        )
      )}
    </div>
  );
}
