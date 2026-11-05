#!/usr/bin/env node
// One file out, safe to copy anywhere, correct even while the OS is running.
//   npm run backup                 → data/backups/commons-<date>.db
//   npm run backup -- <path>       → somewhere you choose
//   npm run backup -- --verify <f> → open a backup and say what is in it
//
// WHY THIS EXISTS. The database runs in WAL mode, so recent writes live in
// `commons.db-wal` rather than in `commons.db`. The docs used to say "copy that
// one file and you have a complete backup". That is false, and it fails in the
// worst way available: the copy exists, opens, and looks entirely normal, while
// being stale by however much had not been checkpointed. It was found by
// accident — a chapter was deleted, the file was copied, and the copy still had
// the chapter in it. Nothing warned anybody.
//
// `VACUUM INTO` is the fix rather than "stop the OS and copy three files",
// because a backup procedure a community will not follow is not a backup. It
// takes a consistent snapshot through SQLite itself, WAL included, into a single
// file — with the OS still running and people still using it.
import { existsSync, mkdirSync, statSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, title, ok, warn, info, cmd, c, line } from './lib.mjs';
import { dbPath } from '../core/db.mjs';
import { mediaDir } from '../engines/proof.mjs';

// ── The photographs are not in the database ───────────────────────────────
// This file's whole argument was "one file, complete, safe to copy anywhere",
// and it was true right up until the commons started holding evidence. A
// before-and-after lives in data/media; the row that names it lives in the
// database. Backing up only the database produces exactly the failure this
// script exists to prevent, in exactly the same shape: the copy exists, opens,
// looks entirely normal, and every photograph in it is a broken link.
//
// So the media travels with the backup, in a folder beside it named after it,
// and the wording below no longer says "one file" when there is more than one.
// Restoring is then two moves rather than one, which is worse — and a backup
// that quietly drops the evidence behind the work is worse than that.
function backUpMedia(target) {
  const from = mediaDir();
  if (!existsSync(from)) return null;
  const files = readdirSync(from).filter((f) => !f.startsWith('.'));
  if (!files.length) return null;
  const to = `${target.replace(/\.db$/, '')}-media`;
  cpSync(from, to, { recursive: true });
  const bytes = readdirSync(to).reduce((n, f) => {
    try { return n + statSync(join(to, f)).size; } catch { return n; }
  }, 0);
  return { to, count: files.length, bytes };
}

const args = process.argv.slice(2);
const verifyAt = args.includes('--verify') ? args[args.indexOf('--verify') + 1] : null;

function human(n) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** Say what is actually inside a backup file, so "it exists" is not the only check. */
function describe(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const count = (t) => {
    try { return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { return null; }
  };
  const rows = {
    chapters: count('chapters'), places: count('places'), signals: count('signals'),
    quests: count('quests'), decisions: count('decisions'), intake: count('intake'),
    gatherings: count('gatherings'), learn: count('learn'), exchange_events: count('exchange_events'),
    tasks: count('tasks'), proofs: count('proofs'), media: count('media'),
  };
  const integrity = db.prepare('PRAGMA integrity_check').get();
  db.close();
  return { rows, integrity: Object.values(integrity)[0] };
}

if (verifyAt) {
  const file = resolve(verifyAt);
  title('Checking a backup');
  if (!existsSync(file)) { warn(`No file at ${file}`); process.exit(1); }
  const { rows, integrity } = describe(file);
  if (integrity !== 'ok') { warn(`SQLite reports: ${integrity}`); process.exit(1); }
  ok(`Readable and internally consistent — ${human(statSync(file).size)}`);
  for (const [k, v] of Object.entries(rows)) if (v !== null && v > 0) info(`${String(v).padStart(5)}  ${k}`);

  // A backup holding media rows and no media folder is the failure mode this
  // whole script is about, one level up: it opens, it looks complete, and the
  // evidence behind every piece of work in it is gone. Said out loud here,
  // because the only moment anybody checks a backup is this one.
  if (rows.media > 0) {
    const folder = `${file.replace(/\.db$/, '')}-media`;
    const there = existsSync(folder) ? readdirSync(folder).filter((f) => !f.startsWith('.')).length : 0;
    if (!there) {
      warn(`This backup names ${rows.media} file${rows.media === 1 ? '' : 's'} and none of them is here.`);
      info(`The photographs live beside it, in ${basename(folder)}/ — copy that folder too.`);
      process.exit(1);
    }
    ok(`${there} stored file${there === 1 ? '' : 's'} alongside it in ${basename(folder)}/`);
  }
  console.log(`\n  ${c.dim}To use it: stop the OS, then copy this file over data/commons.db` +
    (rows.media > 0 ? `\n  and the folder beside it over data/media` : '') + `${c.reset}\n`);
  process.exit(0);
}

title('Backing up your commons');

const source = dbPath();
if (!existsSync(source)) {
  warn('There is no commons yet — nothing to back up.');
  cmd('npm run setup');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
// Beside the database being backed up, not beside the project — so BROS_DB
// pointing elsewhere writes its backup there too, and never into the real one.
const target = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(source), 'backups', `commons-${stamp}.db`));
if (existsSync(target)) {
  // VACUUM INTO refuses an existing file. Say so in words rather than letting
  // SQLite's message be the thing a person has to interpret.
  warn(`Something is already at ${target}`);
  info('Backups are never overwritten — move it, or choose another name.');
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });

// The whole point: this reads through SQLite, so whatever is only in the WAL
// comes too, and the OS can keep running while it happens.
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const wal = `${source}-wal`;
const walSize = existsSync(wal) ? statSync(wal).size : 0;
const { rows, integrity } = describe(target);

const media = backUpMedia(target);

ok(`Written to ${target}`);
info(media
  ? `${human(statSync(target).size)} — complete, and safe to copy with the folder beside it`
  : `${human(statSync(target).size)} — one file, complete, safe to copy anywhere`);
if (media) {
  ok(`${media.count} stored file${media.count === 1 ? '' : 's'} copied to ${basename(media.to)}/ — ${human(media.bytes)}`);
  info('The photographs are not inside the database. Keep the folder with the file.');
}
if (integrity !== 'ok') { warn(`SQLite reports: ${integrity}`); process.exit(1); }
ok('Opened and checked — it is internally consistent');
for (const [k, v] of Object.entries(rows)) if (v !== null && v > 0) info(`${String(v).padStart(5)}  ${k}`);

if (walSize > 0) {
  console.log(`\n  ${c.dim}${human(walSize)} of your commons was sitting in the write-ahead log and not in`);
  console.log(`  commons.db itself. Copying that one file by hand would have missed it —`);
  console.log(`  this backup has it.${c.reset}`);
}

console.log(`\n  ${c.dim}${line()}${c.reset}`);
console.log(`  ${c.dim}Keep ${media ? 'both' : 'it'} somewhere that is not this computer. Check one with:${c.reset}`);
cmd(`npm run backup -- --verify "${target}"`);
console.log();
