import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRules, defaultSettings, MANUAL_RETENTION_DAYS } from '../shared/formats.ts';
import type { Session } from '../shared/types.ts';

// Database sementara khusus tes (bukan data/match.db).
process.env.DB_FILE = join(mkdtempSync(join(tmpdir(), 'match-retensi-')), 'test.db');
const { accounts, hosts, playerTokens, sessions } = await import('../server/db.ts');

const day = 86_400_000;
function session(id: string, bookingId: string, endedDaysAgo: number): Session {
  const end = new Date(Date.now() - endedDaysAgo * day).toISOString();
  return {
    id, slug: `slug-${id}`, refKey: 'k', hostId: 'h1', hostName: 'Rina', sport: 'padel', format: 'americano', name: id,
    bookingId, start: end, end, courts: 1, courtNames: ['Padel'], teamSize: 2, rules: defaultRules('padel'),
    maxPlayers: null, settings: defaultSettings(), players: [], rounds: [], status: 'finished', createdAt: 0, version: 1,
  };
}

test(`sesi manual akun umum dihapus ${MANUAL_RETENTION_DAYS} hari setelah jam main; data akun tetap`, () => {
  hosts.upsert({ id: 'h1', name: 'Rina', phone: '6281311112222', token: 'tok-h1' });
  accounts.create({ host_id: 'h1', email: 'rina@mail.com', pin_hash: 'hash', pin_salt: 'salt' });

  sessions.save(session('manual-lama', 'MANUAL-aaa', MANUAL_RETENTION_DAYS + 1));
  sessions.save(session('manual-baru', 'MANUAL-bbb', MANUAL_RETENTION_DAYS - 1));
  sessions.save(session('winscourt-lama', 'WC-1001', MANUAL_RETENTION_DAYS + 30));
  playerTokens.create('pt-lama', 'manual-lama', 'p1');
  playerTokens.create('pt-baru', 'manual-baru', 'p2');

  const { slugs } = sessions.purgeManual(MANUAL_RETENTION_DAYS);

  assert.deepEqual(slugs, ['slug-manual-lama']);
  assert.equal(sessions.get('slug-manual-lama'), undefined, 'sesi manual > 30 hari terhapus');
  assert.ok(sessions.get('slug-manual-baru'), 'sesi manual < 30 hari tetap');
  assert.ok(sessions.get('slug-winscourt-lama'), 'sesi dari booking Wins Court tidak ikut dihapus');
  assert.equal(playerTokens.resolve('pt-lama', 'manual-lama'), undefined, 'token pemain sesi lama ikut terhapus');
  assert.equal(playerTokens.resolve('pt-baru', 'manual-baru'), 'p2');
  // Data akun tetap: nama, no. HP, email, PIN.
  assert.equal(hosts.byPhone('6281311112222')?.name, 'Rina');
  assert.equal(accounts.byHost('h1')?.email, 'rina@mail.com');
  assert.equal(accounts.byHost('h1')?.pin_hash, 'hash');
});
