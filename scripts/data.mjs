#!/usr/bin/env node
// Download and refresh the ecoregion library.
//
//   npm run data                     bring my chapter's regions up to date
//   npm run data -- --near           ...and the ones next door
//   npm run data -- --region 30c     one region
//   npm run data -- --all            every ecoregion in the country (~100 MB)
//   npm run data -- --status         what is downloaded, what is stale
//   npm run data -- --build-index    rebuild the region index
//   npm run data -- --offline        prove the library works with no network
//   npm run data -- --bundle         pack the library onto a USB stick
//
// Safe to stop and re-run at any point. It never refetches a section that is
// still inside its cadence, so a second run costs almost nothing.
import { one } from '../core/db.mjs';
import { compile, coverage, region, regions, CADENCE_DAYS } from '../adapters/dossier.mjs';
import { workList, myRegions, brief, findSpecies } from '../engines/library.mjs';
import { title, ok, warn, bad, info, cmd, c, line, isMain } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const kb = (b) => (b / 1024).toFixed(0) + ' KB';

async function main() {
  if (flag('build-index')) {
    const { buildIndex } = await import('./build-index.mjs');
    await buildIndex();
    return;
  }
  if (flag('status')) return status();
  if (flag('offline')) return offlineProof();
  if (flag('bundle')) return bundle();

  const chapterId = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;
  let targets;

  if (val('region')) {
    const code = val('region');
    const r = region(code) ?? region(code, { scheme: 'epa-l3' });
    if (!r) { bad(`No ecoregion "${code}".`); info('Try  npm run data -- --status  to see what exists.'); process.exit(1); }
    targets = [{ code: r.code, name: r.name, scheme: r.scheme }];
  } else if (flag('all')) {
    targets = [
      ...regions({ scheme: 'epa-l3' }).map((r) => ({ code: r.code, name: r.name, scheme: 'epa-l3' })),
      ...regions().map((r) => ({ code: r.code, name: r.name, scheme: 'epa-l4' })),
    ];
  } else {
    const work = workList(chapterId);
    targets = [...work.missing, ...work.stale];
    if (flag('near') && chapterId) {
      const { neighbours } = await import('../engines/library.mjs');
      const seen = new Set(targets.map((t) => t.code));
      for (const r of myRegions(chapterId).level4) {
        for (const n of neighbours(r.code, { limit: 12 })) {
          if (!seen.has(n.code)) { targets.push({ code: n.code, name: n.name, scheme: 'epa-l4' }); seen.add(n.code); }
        }
      }
    }
    if (!targets.length) {
      title('Ecoregion library');
      ok('Everything for this chapter is downloaded and current.');
      info('Add the regions next door with  npm run data -- --near');
      info(`Or the whole country with  npm run data -- --all`);
      return;
    }
  }

  title(`Downloading ${targets.length} region${targets.length === 1 ? '' : 's'}`);

  if (flag('all')) {
    const cov = coverage();
    const est = cov.estimated_full_bytes ?? 967 * 105000;
    warn(`This fetches every ecoregion in the United States.`);
    info(`Roughly ${mb(est)} on disk, and a few hours of polite requests to free public APIs.`);
    info(`It is fully resumable — stop with Control+C and run it again whenever.`);
    info(`Starting in 5 seconds. Control+C to back out.`);
    await pause(5000);
  }

  let done = 0, bytes = 0, failed = 0, skipped = 0;
  const started = Date.now();

  for (const t of targets) {
    const label = `${t.code} ${t.name}`.padEnd(46).slice(0, 46);
    process.stdout.write(`  ${label} `);
    try {
      const r = await compile(t.code, { scheme: t.scheme });
      if (r.error) { console.log(`${c.red}✗${c.reset} ${r.error}`); failed++; }
      else if (r.unchanged) { console.log(`${c.dim}current${c.reset}`); skipped++; }
      else { console.log(`${c.green}✓${c.reset} ${kb(r.bytes)}  ${c.dim}${r.refreshed.join(' ')}${c.reset}`); done++; bytes += r.bytes; }
    } catch (err) { console.log(`${c.red}✗${c.reset} ${err.message.slice(0, 60)}`); failed++; }
    await pause(300);
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n  ${c.dim}${line()}${c.reset}`);
  ok(`${done} downloaded  ·  ${skipped} already current  ·  ${failed} failed  ·  ${mb(bytes)} in ${mins} min`);
  if (failed) info('Failures are usually a rate limit or a dropped connection. Run it again — it resumes.');
  console.log('');
  status({ brief: true });
}

function status({ brief: short = false } = {}) {
  if (!short) title('Ecoregion library');
  const cov = coverage();
  const bar = (pct) => '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');
  console.log(`  Level IV  ${bar(cov.level4.percent)} ${cov.level4.downloaded}/${cov.level4.total}  ${mb(cov.level4.bytes)}${cov.level4.stale ? `  (${cov.level4.stale} stale)` : ''}`);
  console.log(`  Level III ${bar(cov.level3.percent)} ${cov.level3.downloaded}/${cov.level3.total}  ${mb(cov.level3.bytes)}${cov.level3.stale ? `  (${cov.level3.stale} stale)` : ''}`);
  if (cov.estimated_full_bytes) {
    info(`Complete US coverage would be about ${mb(cov.estimated_full_bytes)}.`);
  }
  if (short) return;

  const chapterId = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id;
  if (chapterId) {
    const mine = myRegions(chapterId);
    console.log(`\n  ${c.bold}This chapter sits in${c.reset}`);
    for (const r of mine.level4) {
      const b = brief(r.code);
      console.log(`    ${r.code.padEnd(5)} ${r.name.padEnd(34)} ${b.downloaded ? c.green + 'downloaded' + c.reset : c.gold + 'not downloaded' + c.reset}`);
    }
    for (const r of mine.level3) {
      const b = brief(r.code, { scheme: 'epa-l3' });
      console.log(`    ${r.code.padEnd(5)} ${r.name.padEnd(34)} ${b.downloaded ? c.green + 'downloaded' + c.reset : c.gold + 'not downloaded' + c.reset}  ${c.dim}(level III)${c.reset}`);
    }
  }

  console.log(`\n  ${c.bold}How often each part is refreshed${c.reset}`);
  for (const [section, days] of Object.entries(CADENCE_DAYS)) {
    const when = days === null ? 'never re-asked' : days >= 365 ? `every ${(days / 365).toFixed(0)} year(s)` : `every ${days} days`;
    console.log(`    ${section.padEnd(12)} ${c.dim}${when}${c.reset}`);
  }
  console.log(`\n  ${c.dim}${line()}${c.reset}`);
  cmd('npm run data                 update this chapter\'s regions');
  cmd('npm run data -- --near       add the regions next door');
  cmd('npm run data -- --all        every ecoregion in the country');
  console.log('');
}

/**
 * Pack the whole library into one file somebody can carry to a place with no
 * connection. The dossiers are not in git — they are regenerable, and ~97 MB of
 * permanent history would make the repository heavy for everyone who only wants
 * their own bioregion. A bundle is the right shape for moving them.
 */
async function bundle() {
  const { execFileSync } = await import('node:child_process');
  const { existsSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROOT } = await import('../core/db.mjs');
  title('Packing the library');
  const dir = join(ROOT, 'data', 'dossiers');
  if (!existsSync(dir)) { warn('Nothing downloaded yet.'); cmd('npm run data'); return; }
  const cov = coverage();
  const out = join(ROOT, '..', `bioregional-library-${new Date().toISOString().slice(0, 10)}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', join(ROOT, 'data'), 'dossiers', 'regions'], { stdio: 'inherit' });
  ok(`${cov.level4.downloaded + cov.level3.downloaded} regions packed`);
  info(out);
  info(`${mb(statSync(out).size)} — copy it anywhere, then unpack into data/ and it all reads offline.`);
  cmd('tar -xzf bioregional-library-*.tar.gz -C data/');
  console.log('');
}

/** Prove the claim: the library answers with the network unplugged. */
function offlineProof() {
  title('Offline check');
  const cov = coverage();
  if (!cov.level4.downloaded && !cov.level3.downloaded) {
    warn('Nothing downloaded yet, so there is nothing to read offline.');
    cmd('npm run data');
    return;
  }
  info('Reading from disk only — no network calls are made by any of this.');
  const chapterId = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id;
  const mine = chapterId ? myRegions(chapterId).level4 : [];
  const code = mine[0]?.code ?? null;
  if (code) {
    const b = brief(code);
    if (b.downloaded) {
      console.log(`\n  ${c.bold}${b.region}${c.reset}  ${c.dim}${b.identity.level3} · ${b.identity.biome}${c.reset}`);
      console.log(`    ${b.life.plants_recorded} plants · ${b.life.animals_recorded} animals · ${b.life.insects_recorded} insects · ${b.life.threatened_count} threatened`);
      if (b.life.signature_plants?.length) console.log(`    commonly seen: ${b.life.signature_plants.slice(0, 5).join(', ')}`);
      if (b.soil?.map_unit) console.log(`    soil: ${b.soil.map_unit}`);
    }
  }
  const hit = findSpecies('oak');
  console.log(`\n  ${c.bold}Offline species search${c.reset} — "oak": ${hit.matches} match(es)`);
  for (const h of hit.results.slice(0, 4)) {
    console.log(`    ${(h.common_name || h.scientific_name || '?').padEnd(28)} ${h.region}`);
  }
  console.log(`\n  ${c.green}The library works with no connection.${c.reset}\n`);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
if (isMain(import.meta.url)) await main();
