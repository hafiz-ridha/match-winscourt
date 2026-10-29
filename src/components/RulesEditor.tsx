import type { FormatId, ScoreRules, SessionSettings, Sport } from '../../shared/types.ts';
import { Seg, Stepper, Switch } from './ui.tsx';

export function RulesEditor({ sport, rules, onChange }: { sport: Sport; rules: ScoreRules; onChange: (r: ScoreRules) => void }) {
  const set = (patch: Partial<ScoreRules>) => onChange({ ...rules, ...patch });
  if (sport === 'badminton') {
    return (
      <div className="field">
        <span className="label">Target poin</span>
        <div className="row-between">
          <Stepper value={rules.target} min={5} max={99} onChange={(target) => set({ target })} />
          <div className="minichips">
            {[11, 15, 21, 25, 31].map((v) => (
              <button key={v} type="button" className={rules.target === v ? 'on' : ''} onClick={() => set({ target: v })}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <span className="hint">Rally point, selisih 2. Wasit bisa mengubah target saat main.</span>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="field">
        <span className="label">Tipe skor</span>
        <Seg
          value={rules.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { v: 'points', label: 'Poin langsung' },
            { v: 'games', label: 'Game' },
            { v: 'sets', label: 'Game & Set' },
          ]}
        />
      </div>
      {rules.kind === 'points' && (
        <>
          <div className="field">
            <span className="label">Poin per match</span>
            <div className="minichips">
              {[16, 21, 24, 32, 0].map((v) => (
                <button key={v} type="button" className={rules.target === v ? 'on' : ''} onClick={() => set({ target: v })}>
                  {v === 0 ? 'Bebas' : `${v} poin`}
                </button>
              ))}
            </div>
            <span className="hint">Match selesai saat total poin kedua tim mencapai angka ini (contoh 21 = 12–9).</span>
          </div>
          <div className="field">
            <span className="label">Ganti server tiap</span>
            <Seg value={rules.serveEvery} onChange={(serveEvery) => set({ serveEvery })} options={[2, 4, 5].map((v) => ({ v, label: `${v} poin` }))} />
          </div>
        </>
      )}
      {rules.kind === 'games' && (
        <>
          <div className="field">
            <span className="label">Cara menang</span>
            <Seg
              value={rules.gamesMode}
              onChange={(gamesMode) => set({ gamesMode })}
              options={[
                { v: 'total', label: 'Total games' },
                { v: 'race', label: 'Race to' },
              ]}
            />
            <span className="hint">{rules.gamesMode === 'total' ? 'Selesai setelah sekian game dimainkan. Bisa seri.' : 'Tim pertama yang mencapai target game menang.'}</span>
          </div>
          <div className="field">
            <span className="label">Jumlah game</span>
            <Stepper value={rules.games} min={1} max={30} onChange={(games) => set({ games })} />
          </div>
        </>
      )}
      {rules.kind !== 'points' && (
        <div className="field">
          <span className="label">Aturan 40-40</span>
          <Seg
            value={rules.deuce}
            onChange={(deuce) => set({ deuce })}
            options={[
              { v: 'golden', label: 'Golden point' },
              { v: 'advantage', label: 'Advantage' },
              { v: 'star', label: 'Star point' },
            ]}
          />
          <span className="hint">
            {rules.deuce === 'golden'
              ? 'Di 40-40, poin berikutnya menang.'
              : rules.deuce === 'advantage'
                ? 'Harus unggul 2 poin (AD).'
                : 'Dua kali advantage, deuce ketiga jadi golden point.'}
          </span>
          {rules.kind === 'sets' && <span className="hint">Best of 3 set, tie-break di 6-6, super tie-break 10 di set penentu.</span>}
        </div>
      )}
    </div>
  );
}

export function SettingsEditor({
  format,
  settings,
  onChange,
}: {
  format: FormatId;
  settings: SessionSettings;
  onChange: (s: SessionSettings) => void;
}) {
  const set = (patch: Partial<SessionSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="stack">
      <Switch label="Seimbangkan level" hint="Total level kedua tim dibuat setara." on={settings.levelBalance} onChange={(levelBalance) => set({ levelBalance })} />
      <Switch
        label="Kompensasi poin (+M)"
        hint="Pemain yang main lebih sedikit mendapat poin rata-ratanya untuk match yang terlewat."
        on={settings.compensation}
        onChange={(compensation) => set({ compensation })}
      />
      <Switch label="Sembunyikan peringkat" hint="Pemain baru melihat peringkat setelah sesi selesai." on={settings.hideLeaderboard} onChange={(hideLeaderboard) => set({ hideLeaderboard })} />
      <div className="field">
        <span className="label">Urutkan peringkat</span>
        <Seg
          value={settings.sortBy}
          onChange={(sortBy) => set({ sortBy })}
          options={[
            { v: 'points', label: 'Poin' },
            { v: 'wins', label: 'Menang' },
          ]}
        />
      </div>
      {format === 'koth' && <Switch label="Bonus lapangan atas" hint="Menang di lapangan atas memberi poin bonus." on={settings.kothBonus} onChange={(kothBonus) => set({ kothBonus })} />}
      {format === 'winner_stays' && (
        <div className="field">
          <span className="label">Maks. menang beruntun</span>
          <Stepper value={settings.maxWinStreak} min={1} max={5} onChange={(maxWinStreak) => set({ maxWinStreak })} />
        </div>
      )}
      {format === 'group_ko' && (
        <div className="field">
          <span className="label">Jumlah grup</span>
          <Stepper value={settings.groups} min={1} max={4} onChange={(groups) => set({ groups })} />
        </div>
      )}
      {(format === 'knockout' || format === 'group_ko') && (
        <Switch label="Perebutan juara 3" on={settings.thirdPlace} onChange={(thirdPlace) => set({ thirdPlace })} />
      )}
      <div className="field">
        <span className="label">Ronde ditampilkan ke depan</span>
        <Stepper value={settings.lookahead} min={1} max={8} onChange={(lookahead) => set({ lookahead })} />
        <span className="hint">Untuk format yang jadwalnya tidak bergantung hasil.</span>
      </div>
    </div>
  );
}
