import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailIssue, emailSuggestion, phoneIssue } from '../shared/contact.ts';
import { normalizePhone } from '../shared/util.ts';

const p = (s: string) => phoneIssue(normalizePhone(s));

test('no. HP: nomor seluler Indonesia yang wajar diterima', () => {
  for (const ok of ['0812 3456 7891', '+62 857-2931-4486', '6281937264518', '08957283916', '0881 2233 4455']) assert.equal(p(ok), null, ok);
});

test('no. HP: asal-asalan ditolak', () => {
  assert.match(p('0212345678')!, /seluler|08/); // telepon rumah
  assert.match(p('0800 1234 5678')!, /Awalan/); // awalan tidak dikenal
  assert.match(p('081111111111')!, /berulang/);
  assert.match(p('0812 3456 7890')!, /berurutan/);
  assert.match(p('08123')!, /10–13/);
  assert.match(p('08123456789012345')!, /10–13/);
});

test('email: wajar diterima, salah ketik diberi saran, sementara ditolak', () => {
  assert.equal(emailIssue('budi.santoso@gmail.com'), null);
  assert.equal(emailIssue('admin@wins-court.com'), null);
  assert.equal(emailSuggestion('budi@gmial.com'), 'budi@gmail.com');
  assert.match(emailIssue('budi@gmial.com')!, /budi@gmail\.com/);
  assert.match(emailIssue('x@mailinator.com')!, /sementara/);
  assert.match(emailIssue('bukan-email')!, /Format/);
  assert.match(emailIssue('a@b')!, /Format/);
});
