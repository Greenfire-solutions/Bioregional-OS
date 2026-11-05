#!/usr/bin/env node
// Keeps the OS current. Run it whenever you like — it is safe and idempotent.
//   npm run update              refresh reference data + rebuild the interface
//   npm run update -- --package make a clean copy for another community
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, title, ok, warn, info, cmd, run, c, line } from './lib.mjs';

if (process.argv.includes('--package')) {
  const out = join(ROOT, '..', 'BioRegional-OS-to-share');
  title('Making a copy to give away');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const dir of ['core', 'engines', 'adapters', 'ai', 'mcp', 'server', 'scripts', 'docs', 'content', 'bin']) {
    cpSync(join(ROOT, dir), join(out, dir), { recursive: true });
  }
  cpSync(join(ROOT, 'app'), join(out, 'app'), {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.includes(`${'app'}/dist`),
  });
  for (const f of ['package.json', 'LICENSE', '.gitignore', '.mcp.json', 'README.md']) {
    if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(out, f));
  }
  mkdirSync(join(out, 'data'), { recursive: true });
  writeFileSync(join(out, 'data', '.gitkeep'), '');
  ok(`Copy written to  ${out}`);
  info('It contains the protocol, the code and the example seed — and none of your commons data.');
  info('Tell them: open a terminal in that folder and run  npm run setup');
  console.log('');
  process.exit(0);
}

title('Updating BioRegional OS');

// 1 — refresh cached reference data by re-resolving every place
const dbFile = join(ROOT, 'data', 'commons.db');
if (existsSync(dbFile)) {
  const { all } = await import('../core/db.mjs');
  const bio = await import('../engines/bioregional.mjs');
  const places = all('SELECT id, name FROM places');
  for (const p of places) {
    try {
      const r = await bio.locate(p.id);
      ok(`${p.name} → ${r.place?.ecoregion_name ?? '?'} · ${r.place?.watershed_name ?? '?'}`);
    } catch (e) { warn(`${p.name} — could not refresh (${e.message})`); }
  }
  for (const p of places) {
    try {
      const r = await bio.ingestWater(p.id);
      if (r.added || r.updated) ok(`${p.name} → water readings: ${r.added} new, ${r.updated} updated`);
    } catch { /* offline is fine */ }
  }
} else {
  warn('No commons data yet — run  npm run seed  first.');
}

// 2 — rebuild the interface so code changes show up
if (existsSync(join(ROOT, 'app', 'node_modules'))) {
  console.log('');
  if (run('npm', ['run', 'build'], { cwd: join(ROOT, 'app') })) ok('Interface rebuilt');
  else warn('Interface did not rebuild — run  npm run doctor');
}

// 3 — global ecoregion layer reminder
if (!existsSync(join(ROOT, 'data', 'upstream', 'global-ecoregions.geojson'))) {
  console.log('');
  info('Optional: to see ecoregions outside the United States, drop a GeoJSON at');
  info('data/upstream/global-ecoregions.geojson — see docs/INTEROP.md for sources.');
}

console.log(`\n  ${c.dim}${line()}${c.reset}`);
console.log(`  Done. Start it with  ${c.blue}npm run os -- --open${c.reset}\n`);
