// Local-first store. Node's built-in SQLite — no native build step, no server.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRid, newId } from './ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const DB_PATH = process.env.BROS_DB || join(ROOT, 'data', 'commons.db');

let _db = null;

export function db() {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  return _db;
}

export function close() {
  if (_db) { _db.close(); _db = null; }
}

/** Insert a row and register its RID in one step. */
export function create(table, objectType, chapterId, row, sensitivity = 'public') {
  const d = db();
  const id = row.id || newId(objectType.slice(0, 4));
  const full = { ...row, id };
  const cols = Object.keys(full);
  const stmt = d.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  );
  stmt.run(...cols.map((c) => normalize(full[c])));
  d.prepare(
    `INSERT OR IGNORE INTO rids (rid, object_type, local_id, chapter_id, sensitivity)
     VALUES (?,?,?,?,?)`
  ).run(makeRid(objectType, chapterId, id), objectType, id, chapterId, sensitivity);
  return { ...full, rid: makeRid(objectType, chapterId, id) };
}

export function all(sql, ...params) {
  return db().prepare(sql).all(...params.map(normalize));
}

export function one(sql, ...params) {
  return db().prepare(sql).get(...params.map(normalize)) ?? null;
}

export function run(sql, ...params) {
  return db().prepare(sql).run(...params.map(normalize));
}

/** node:sqlite only binds null/number/string/bigint/Uint8Array. */
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

export function isFresh() {
  return !existsSync(DB_PATH);
}
