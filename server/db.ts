import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Session } from '../shared/types.ts';

const file = resolve(process.env.DB_FILE ?? 'data/match.db');
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    host_id TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_host ON sessions(host_id);
  CREATE TABLE IF NOT EXISTS player_tokens (
    token TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    player_id TEXT NOT NULL
  );
  -- Akun umum (tanpa booking Wins Court): login no. HP / email + PIN 6 digit.
  -- Terhubung ke baris hosts lewat host_id (no. HP sama = identitas host yang sama).
  CREATE TABLE IF NOT EXISTS accounts (
    host_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

export interface Host {
  id: string;
  name: string;
  phone: string;
  token: string;
}

export const hosts = {
  byToken(token: string): Host | undefined {
    return db.prepare('SELECT id, name, phone, token FROM hosts WHERE token = ?').get(token) as Host | undefined;
  },
  byPhone(phone: string): Host | undefined {
    return db.prepare('SELECT id, name, phone, token FROM hosts WHERE phone = ?').get(phone) as Host | undefined;
  },
  upsert(h: Host) {
    db.prepare(
      `INSERT INTO hosts (id, name, phone, token, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, token = excluded.token`,
    ).run(h.id, h.name, h.phone, h.token, Date.now());
    return hosts.byPhone(h.phone)!;
  },
};

export interface Account {
  host_id: string;
  email: string;
  pin_hash: string;
  pin_salt: string;
}

export const accounts = {
  byHost(hostId: string): Account | undefined {
    return db.prepare('SELECT host_id, email, pin_hash, pin_salt FROM accounts WHERE host_id = ?').get(hostId) as Account | undefined;
  },
  byEmail(email: string): Account | undefined {
    return db.prepare('SELECT host_id, email, pin_hash, pin_salt FROM accounts WHERE email = ?').get(email) as Account | undefined;
  },
  create(a: Account) {
    db.prepare('INSERT INTO accounts (host_id, email, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(
      a.host_id,
      a.email,
      a.pin_hash,
      a.pin_salt,
      Date.now(),
    );
  },
};

export const hostById = (id: string): Host | undefined =>
  db.prepare('SELECT id, name, phone, token FROM hosts WHERE id = ?').get(id) as Host | undefined;

export const sessions = {
  get(slug: string): Session | undefined {
    const row = db.prepare('SELECT data FROM sessions WHERE slug = ?').get(slug) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Session) : undefined;
  },
  byHost(hostId: string): Session[] {
    const rows = db.prepare('SELECT data FROM sessions WHERE host_id = ? ORDER BY updated_at DESC').all(hostId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Session);
  },
  save(s: Session) {
    db.prepare(
      `INSERT INTO sessions (id, slug, host_id, booking_id, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(s.id, s.slug, s.hostId, s.bookingId, JSON.stringify(s), Date.now());
  },
  remove(id: string) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    db.prepare('DELETE FROM player_tokens WHERE session_id = ?').run(id);
  },
};

export const playerTokens = {
  create(token: string, sessionId: string, playerId: string) {
    db.prepare('INSERT INTO player_tokens (token, session_id, player_id) VALUES (?, ?, ?)').run(token, sessionId, playerId);
  },
  resolve(token: string, sessionId: string): string | undefined {
    const row = db.prepare('SELECT player_id FROM player_tokens WHERE token = ? AND session_id = ?').get(token, sessionId) as
      | { player_id: string }
      | undefined;
    return row?.player_id;
  },
};
