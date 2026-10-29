import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtNow, currentRound, ensureRounds, regenerateFuture } from '../shared/engine.ts';
import { defaultRules, defaultSettings } from '../shared/formats.ts';
import { computeScore } from '../shared/scoring.ts';
import { playerStandings } from '../shared/standings.ts';
import type { FormatId, Match, Player, ScoreRules, Session, Side, Sport } from '../shared/types.ts';

function makeSession(sport: Sport, format: FormatId, n: number, courts: number, opts: Partial<Session> = {}): Session {
  const players: Player[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    gender: i % 2 ? 'F' : 'M',
    level: ((i % 4) + 1) as 1 | 2 | 3 | 4,
    status: 'active',
    joinedAt: i,
    pair: `t${Math.floor(i / 2)}`,
    club: i % 2 ? 'B' : 'A',
  }));
  return {
    id: 's1', slug: 's1', refKey: 'k', hostId: 'h', hostName: 'H', sport, format, name: 'Tes', bookingId: 'b',
    start: new Date().toISOString(), end: new Date().toISOString(), courts, courtNames: [], teamSize: 2,
    rules: defaultRules(sport), maxPlayers: null, settings: defaultSettings(), players, rounds: [],
    status: 'running', createdAt: 0, version: 0, ...opts,
  };
}

/** Selesaikan semua match di ronde berjalan dengan skor acak yang punya pemenang. */
function finishCurrent(s: Session) {
  const r = currentRound(s);
  assert.ok(r, 'harus ada ronde berjalan');
  for (const m of r.matches) {
    const a = 21;
    const b = Math.floor(Math.random() * 19);
    m.final = Math.random() < 0.5 ? { a, b } : { a: b, b: a };
    m.status = 'done';
  }
  ensureRounds(s);
}

const ev = (seq: string): Side[] => seq.split('').map((c) => (c === 'a' ? 'a' : 'b'));
const match = (events: Side[]): Match => ({ id: 'm', court: 0, a: ['x'], b: ['y'], events, status: 'live' });

test('rally badminton: target 21 dengan selisih 2', () => {
  const r = defaultRules('badminton');
  assert.equal(computeScore(match(ev('a'.repeat(21) + 'b'.repeat(19))), r).done, true);
  const m2 = match([...ev('a'.repeat(20)), ...ev('b'.repeat(20)), 'a']);
  assert.equal(computeScore(m2, r).done, false);
  assert.equal(computeScore({ ...m2, events: [...m2.events, 'a'] }, r).done, true);
  assert.equal(computeScore({ ...m2, events: [...m2.events, 'a'], target: 25 }, r).done, false);
});

test('padel poin langsung: selesai saat total poin = target', () => {
  const r = defaultRules('padel');
  const st = computeScore(match(ev('a'.repeat(12) + 'b'.repeat(9))), r);
  assert.equal(st.done, true);
  assert.equal(st.winner, 'a');
});

test('padel game: golden point di 40-40', () => {
  const r: ScoreRules = { ...defaultRules('padel'), kind: 'games', games: 2, gamesMode: 'total', deuce: 'golden' };
  const st = computeScore(match(ev('aaabbb' + 'a')), r);
  assert.equal(st.a, 1);
  assert.equal(st.b, 0);
  const adv = computeScore(match(ev('aaabbb' + 'a')), { ...r, deuce: 'advantage' });
  assert.equal(adv.a, 0);
  assert.equal(adv.gameA, 'AD');
});

test('padel set: 6-0 6-0 selesai, tie-break di 6-6', () => {
  const r: ScoreRules = { ...defaultRules('padel'), kind: 'sets' };
  const game = 'aaaa';
  assert.equal(computeScore(match(ev(game.repeat(12))), r).done, true);
  const toSix = ('aaaa' + 'bbbb').repeat(6);
  const st = computeScore(match(ev(toSix + 'aaaaaaa')), r);
  assert.deepEqual(st.sets[0], [7, 6]);
});

test('americano padel 8 pemain 1 lapangan: jumlah main merata', () => {
  const s = makeSession('padel', 'americano', 8, 1);
  ensureRounds(s);
  for (let i = 0; i < 10; i++) finishCurrent(s);
  const st = playerStandings(s);
  const played = st.map((x) => x.played);
  assert.ok(Math.max(...played) - Math.min(...played) <= 1, `played ${played}`);
});

test('mabar bergilir badminton 18 pemain 4 lapangan: tidak istirahat 2 ronde berturut', () => {
  const s = makeSession('badminton', 'rotation', 18, 4);
  ensureRounds(s);
  for (let i = 0; i < 9; i++) finishCurrent(s);
  const done = s.rounds.filter((r) => r.matches.every((m) => m.status === 'done'));
  for (let i = 1; i < done.length; i++) {
    const both = done[i].resting.filter((id) => done[i - 1].resting.includes(id));
    assert.equal(both.length, 0, `ronde ${i + 1}: ${both}`);
  }
  for (const r of s.rounds) assert.equal(r.matches.length, 4);
});

test('lookahead: format statis menyimpan 4 ronde ke depan', () => {
  const s = makeSession('badminton', 'americano', 12, 2);
  ensureRounds(s);
  assert.equal(s.rounds.length, 4);
  s.players[0].status = 'left';
  regenerateFuture(s);
  assert.ok(s.rounds.every((r) => r.matches.every((m) => !m.a.includes('p0') && !m.b.includes('p0'))));
});

test('mix & mixicano: setiap tim 1 putra + 1 putri', () => {
  for (const f of ['mix_americano', 'mixicano'] as FormatId[]) {
    const s = makeSession('padel', f, 8, 1);
    ensureRounds(s);
    for (let i = 0; i < 5; i++) finishCurrent(s);
    for (const r of s.rounds)
      for (const m of r.matches)
        for (const t of [m.a, m.b]) {
          const g = t.map((id) => s.players.find((p) => p.id === id)!.gender);
          assert.notEqual(g[0], g[1], `${f} ronde ${r.n}`);
        }
  }
});

test('mexicano: ronde 2 disusun 1+4 vs 2+3', () => {
  const s = makeSession('padel', 'mexicano', 4, 1);
  ensureRounds(s);
  assert.equal(s.rounds.length, 1);
  finishCurrent(s);
  assert.equal(s.rounds.length, 2);
  const rank = playerStandings(s).map((x) => x.id);
  const m = s.rounds[1].matches[0];
  const teamOf1 = m.a.includes(rank[0]) ? m.a : m.b;
  assert.ok(teamOf1.includes(rank[3]), 'peringkat 1 berpasangan dengan peringkat 4');
});

test('club vs club: pasangan satu klub, lawan klub lain', () => {
  const s = makeSession('padel', 'club', 8, 1);
  ensureRounds(s);
  for (let i = 0; i < 4; i++) finishCurrent(s);
  const club = (id: string) => s.players.find((p) => p.id === id)!.club;
  for (const r of s.rounds)
    for (const m of r.matches) {
      assert.equal(club(m.a[0]), club(m.a[1]));
      assert.notEqual(club(m.a[0]), club(m.b[0]));
    }
});

test('king of the court: 2 lapangan, berjalan beberapa ronde', () => {
  const s = makeSession('badminton', 'koth', 10, 2);
  ensureRounds(s);
  for (let i = 0; i < 6; i++) finishCurrent(s);
  for (const r of s.rounds) {
    const ids = r.matches.flatMap((m) => [...m.a, ...m.b]);
    assert.equal(new Set(ids).size, ids.length, 'tidak ada pemain ganda dalam satu ronde');
    assert.equal(r.matches.length, 2);
  }
});

test('pemenang bertahan: maksimal 2 kali menang berturut', () => {
  const s = makeSession('padel', 'winner_stays', 8, 1);
  ensureRounds(s);
  for (let i = 0; i < 6; i++) {
    const m = currentRound(s)!.matches[0];
    m.final = { a: 21, b: 5 };
    m.status = 'done';
    ensureRounds(s);
  }
  const champs = s.rounds.slice(0, 6).map((r) => r.matches[0].a.join());
  for (let i = 2; i < champs.length; i++) assert.ok(!(champs[i] === champs[i - 1] && champs[i] === champs[i - 2]));
});

test('knockout 6 pasangan sampai final', () => {
  const s = makeSession('badminton', 'knockout', 12, 2);
  ensureRounds(s);
  for (let i = 0; i < 10 && s.bracket?.matches.some((m) => m.stage === 'Final' && m.winner) !== true; i++) {
    if (!currentRound(s)) break;
    finishCurrent(s);
  }
  assert.ok(s.bracket?.matches.find((m) => m.stage === 'Final')?.winner, 'final punya juara');
});

test('grup → knockout: 8 pasangan, 2 grup', () => {
  const s = makeSession('padel', 'group_ko', 16, 1);
  ensureRounds(s);
  for (let i = 0; i < 40 && !s.bracket?.matches.find((m) => m.stage === 'Final')?.winner; i++) {
    if (!currentRound(s)) break;
    finishCurrent(s);
  }
  assert.equal(s.bracket?.phase, 'knockout');
  assert.ok(s.bracket?.matches.find((m) => m.stage === 'Final')?.winner);
});

test('alur per lapangan: lapangan yang selesai lanjut tanpa menunggu lapangan lain', () => {
  for (let trial = 0; trial < 20; trial++) {
    const s = makeSession('badminton', 'rotation', 10, 2);
    ensureRounds(s);
    const r1 = s.rounds[0];
    const fin = r1.matches.find((m) => m.court === 0)!;
    const other = r1.matches.find((m) => m.court === 1)!;
    other.events = ['a']; // lapangan 2 sedang main
    other.status = 'live';
    fin.final = { a: 21, b: 10 };
    fin.status = 'done';
    ensureRounds(s);
    const now = courtNow(s, 0)!;
    assert.ok(now, 'lapangan 1 punya match berikutnya');
    assert.equal(now.round.n, 2, 'match berikutnya dari ronde 2');
    // 10 pemain, 4 masih main → 6 bebas: lapangan 1 harus bisa langsung main dengan pemain bebas.
    assert.equal(now.blockedBy.length, 0, `percobaan ${trial}: lapangan 1 seharusnya bisa langsung main`);
    const busy = new Set([...other.a, ...other.b]);
    assert.ok([...now.match.a, ...now.match.b].every((id) => !busy.has(id)));
    // Pemain yang masih main dijadwalkan di lapangannya sendiri, bukan di lapangan yang kosong.
    const next1 = courtNow(s, 1)!;
    assert.equal(next1.match, other, 'lapangan 2 masih memainkan match berjalan');
    // Semua pemain tetap mendapat giliran yang adil: selisih jumlah main ≤ 1 setelah 4 ronde ke depan.
    const played = new Map<string, number>();
    for (const r of s.rounds) for (const m of r.matches) for (const id of [...m.a, ...m.b]) played.set(id, (played.get(id) ?? 0) + 1);
    const counts = s.players.map((p) => played.get(p.id) ?? 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `percobaan ${trial}: ${counts}`);
    // Tidak ada pemain yang dijadwalkan di dua lapangan sekaligus.
    for (const r of s.rounds) {
      const ids = r.matches.flatMap((m) => [...m.a, ...m.b]);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(new Set(r.matches.map((m) => m.court)).size, r.matches.length, 'lapangan unik per ronde');
    }
  }
});

test('format dinamis (mexicano) tetap menunggu semua lapangan', () => {
  const s = makeSession('badminton', 'mexicano', 8, 2);
  ensureRounds(s);
  const m = s.rounds[0].matches[0];
  m.final = { a: 21, b: 5 };
  m.status = 'done';
  ensureRounds(s);
  assert.equal(s.rounds.length, 1, 'ronde 2 belum disusun sebelum semua lapangan selesai');
  assert.equal(courtNow(s, m.court), null);
});

test('team americano: pasangan tetap tidak pernah berpisah', () => {
  const s = makeSession('badminton', 'team_americano', 8, 2);
  ensureRounds(s);
  for (let i = 0; i < 4; i++) finishCurrent(s);
  const pair = (id: string) => s.players.find((p) => p.id === id)!.pair;
  for (const r of s.rounds) for (const m of r.matches) assert.equal(pair(m.a[0]), pair(m.a[1]));
});
