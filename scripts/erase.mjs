#!/usr/bin/env node
// Actually erase the commons — all of it, not just the file people can see.
//   npm run erase            → show exactly what would go, and how to confirm
//   npm run erase -- --force → do it
//   npm run erase -- --keep-backups
//
// WHY THIS EXISTS. The documentation used to say "delete data/commons.db to
// erase". SQLite runs in WAL mode here, so that leaves `commons.db-wal` and
// `commons.db-shm` on disk — and the log is routinely LARGER than the database,
// so most of the commons survives an erase that looked complete.
//
// That is a consent failure, not untidiness. This protocol lets a rights-holder
// withdraw consent and expects the record to go. A chapter that deleted the file
// because somebody asked them to would believe the thing was gone, tell the
// person it was gone, and be wrong — with no way to find out.
//
// So erase is a command, it names every file before it touches anything, and it
// refuses to run without --force. Cached upstream data is NOT community data and
// is left alone; it is public record that costs only bandwidth to refetch.
import { existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT, title, ok, warn, info, cmd, c, line } from './lib.mjs';
import { dbPath } from '../core/db.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const KEEP_BACKUPS = args.includes('--keep-backups');

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

const db = dbPath();
const targets = [db, `${db}-wal`, `${db}-shm`].filter(existsSync).map((f) => ({ f, size: statSync(f).size }));

// Derived from the DATABASE being erased, not from the project root. Those are
// the same directory in normal use and differ the moment BROS_DB points anywhere
// else — at which point a root-derived path erases the real commons's backups
// while claiming to erase a throwaway. Found exactly that way, by doing it.
const backupDir = join(dirname(dbPath()), 'backups');
const backups = !KEEP_BACKUPS && existsSync(backupDir)
  ? readdirSync(backupDir).filter((f) => f.endsWith('.db')).map((f) => {
      const full = join(backupDir, f);
      return { f: full, size: statSync(full).size };
    })
  : [];

title('Erasing this commons');

if (!targets.length && !backups.length) {
  ok('There is nothing here to erase.');
  process.exit(0);
}

const all = [...targets, ...backups];
const total = all.reduce((n, t) => n + t.size, 0);

console.log(`  ${c.dim}This would permanently remove:${c.reset}\n`);
for (const t of all) console.log(`    ${kb(t.size).padStart(8)}  ${t.f.replace(ROOT + '/', '')}`);
console.log(`\n    ${kb(total).padStart(8)}  in total\n`);

// The number that matters, said plainly: deleting only the visible file is the
// thing this command exists to stop people from doing.
const wal = targets.find((t) => t.f.endsWith('-wal'));
const main = targets.find((t) => t.f === db);
if (wal && main && wal.size > main.size) {
  warn(`${kb(wal.size)} of that is in the write-ahead log, not in commons.db.`);
  info('Deleting commons.db by hand would have left it on disk.');
}
if (backups.length) {
  info(`${backups.length} backup${backups.length > 1 ? 's' : ''} will also go. Keep them with: --keep-backups`);
}

if (!FORCE) {
  console.log(`\n  ${c.dim}${line()}${c.reset}`);
  warn('Nothing has been deleted. This cannot be undone, so it needs saying twice.');
  info('If you have not taken a copy yet and might want one:');
  cmd('npm run backup');
  info('When you are sure:');
  cmd('npm run erase -- --force');
  console.log();
  process.exit(0);
}

for (const t of all) rmSync(t.f, { force: true });

const left = all.filter((t) => existsSync(t.f));
if (left.length) {
  warn('Some files could not be removed:');
  for (const t of left) info(t.f);
  process.exit(1);
}

ok(`Erased — ${kb(total)} across ${all.length} file${all.length > 1 ? 's' : ''}. Nothing is left on disk.`);
info('Cached public data in data/upstream/ was left alone — it is public record, not yours.');
console.log(`\n  ${c.dim}To start again: npm run setup${c.reset}\n`);
