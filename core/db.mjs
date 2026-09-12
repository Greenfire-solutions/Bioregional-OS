// Local-first store. Node's built-in SQLite — no native build step, no server.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRid, newId } from './ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
/**
 * Resolved lazily, on first use — NOT at module load.
 * ES imports are evaluated before the importing module's body runs, so a file
 * that sets BROS_DB in its body would otherwise be too late and would silently
 * open the real commons database. That is how a test suite eats live data.
 */
export function dbPath() {
  return process.env.BROS_DB || join(ROOT, 'data', 'commons.db');
}

let _db = null;
let _path = null;

export function db() {
  if (_db) return _db;
  _path = dbPath();
  mkdirSync(dirname(_path), { recursive: true });
  _db = new DatabaseSync(_path);
  _db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  migrate(_db);
  return _db;
}

/**
 * Columns added after a commons already exists.
 *
 * schema.sql is all CREATE TABLE IF NOT EXISTS, which means a new column in it
 * reaches a fresh database and NOT the one someone has been using for a year —
 * and the failure is a confusing "no such column" rather than anything that
 * points at the cause. So every added column is declared here too, and applied
 * if missing. Adding a column is safe and cheap; this list only ever grows.
 */
const ADDED_COLUMNS = {
  places: [
    ['soil_series', 'TEXT'], ['soil_map_unit', 'TEXT'], ['soil_order', 'TEXT'],
    ['soil_drainage', 'TEXT'], ['soil_hydric', 'INTEGER'], ['soil_ph', 'REAL'],
    ['soil_organic_matter', 'REAL'], ['soil_clay_pct', 'REAL'], ['soil_awc', 'REAL'],
    ['soil_source', 'TEXT'], ['elevation_m', 'REAL'],
    ['land_cover', 'TEXT'], ['land_cover_code', 'INTEGER'],
    ['flood_zone', 'TEXT'], ['in_floodplain', 'INTEGER'],
  ],
  intake: [
    ['responded_at', 'TEXT'],
  ],
  federation_peers: [
    ['summary', 'TEXT'], ['summary_at', 'TEXT'],
  ],
};

function migrate(d) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    let existing;
    try { existing = new Set(d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)); }
    catch { continue; }                       // table not created yet; schema.sql will
    for (const [name, type] of columns) {
      if (existing.has(name)) continue;
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

export function close() {
  if (_db) { _db.close(); _db = null; _path = null; }
}

/** Which file is actually open right now. */
export function openPath() { return _path ?? dbPath(); }

/** Insert a row and register its RID in one step. */
export function create(table, objectType, chapterId, row, sensitivity = 'public') {
  const d = db();
  const id = row.id || newId(objectType.slice(0, 4));
  // Drop absent columns rather than writing NULL into them: an explicit NULL
  // overrides the column DEFAULT, which is how timestamps end up violating
  // NOT NULL. Nothing here ever needs to write NULL on insert.
  const full = Object.fromEntries(
    Object.entries({ ...row, id }).filter(([, v]) => v !== undefined && v !== null)
  );
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

/**
 * "The most recent reading", written once.
 *
 * `ORDER BY measured_at DESC` on its own is not deterministic, and the way it
 * fails is a coin flip rather than an error. measured_at is frequently a DATE —
 * record_measurement takes YYYY-MM-DD and defaults to today — so a
 * before-and-after pair taken on one field morning ties, and "the latest"
 * becomes whichever row SQLite happens to return first. That reverses the sign
 * of a change in a season report, names the wrong person as the one still
 * reading an indicator, and in the two places where `latest_value` and
 * `latest_at` were separate subqueries it could pair one reading's value with a
 * different reading's date.
 *
 * rowid is insertion order, which is the one thing always known and never tied.
 * Exported rather than repeated because there were six copies of this clause
 * and fixing five of them would have been worse than fixing none — the sixth
 * would have disagreed with the rest in a way nothing reports.
 */
export const LATEST_MEASUREMENT = 'ORDER BY measured_at DESC, rowid DESC';

/** The same ordering for a query that has aliased the measurements table. */
export function latestMeasurement(alias) {
  return alias
    ? `ORDER BY ${alias}.measured_at DESC, ${alias}.rowid DESC`
    : LATEST_MEASUREMENT;
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
  return !existsSync(dbPath());
}
