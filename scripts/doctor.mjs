#!/usr/bin/env node
// Checks everything and says, in plain words, what to do about each problem.
// Never changes anything unless you pass --fix.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, title, ok, warn, bad, info, cmd, c, line, run } from './lib.mjs';

const FIX = process.argv.includes('--fix');
let problems = 0;

title('Checking BioRegional OS');

function check(label, pass, whatItMeans, howToFix, fixer) {
  if (pass) return ok(label);
  problems++;
  bad(label);
  info(whatItMeans);
  if (howToFix) cmd(howToFix);
  if (FIX && fixer) { console.log('    fixing…'); fixer(); }
}

// Node
const major = Number(process.versions.node.split('.')[0]);
check(`Node ${process.versions.node}`, major >= 22,
  'BioRegional OS needs Node version 22 or newer to store your data.',
  'Install the LTS version from https://nodejs.org, then run npm run setup');

// Parts
check('Interface parts installed', existsSync(join(ROOT, 'app', 'node_modules')),
  'The pieces that draw the map have not been downloaded yet.',
  'npm run setup', () => run('npm', ['install'], { cwd: join(ROOT, 'app') }));

check('Engine parts installed', existsSync(join(ROOT, 'node_modules', 'qrcode')),
  'The engine is missing some pieces.',
  'npm install', () => run('npm', ['install']));

check('Interface built', existsSync(join(ROOT, 'app', 'dist', 'index.html')),
  'The interface has not been built, so the browser will show a setup page instead of the map.',
  'npm run setup', () => run('npm', ['run', 'build'], { cwd: join(ROOT, 'app') }));

// Data
const dbFile = join(ROOT, 'data', 'commons.db');
check('Your commons data exists', existsSync(dbFile),
  'There is no database yet, so the OS has nothing to show.',
  'npm run seed', () => run('node', ['core/seed.mjs']));

if (existsSync(dbFile)) {
  const { all, one } = await import('../core/db.mjs');
  const chapter = one('SELECT * FROM chapters LIMIT 1');
  check('A chapter is set up', !!chapter,
    'A chapter is the group this commons belongs to. Without one, nothing else has a home.',
    'npm run seed');
  if (chapter) {
    check('Chapter says what it does NOT represent',
      !!chapter.does_not_represent?.trim(),
      'The protocol requires every chapter to publish the limits of what it speaks for. ' +
      'Leaving this blank is how place-based groups get into trouble.',
      'Ask the assistant: "set what this chapter does not represent"');
    const unlocated = all(
      'SELECT name FROM places WHERE chapter_id=? AND (watershed_huc IS NULL OR ecoregion_name IS NULL)',
      chapter.id);
    check('Every place knows its watershed and ecoregion', unlocated.length === 0,
      `${unlocated.length} place(s) have not been matched to real ecological boundaries: ` +
      unlocated.map((p) => p.name).join(', '),
      'Ask the assistant: "locate every place"');
  }
}

// Connectivity — these are conveniences, not requirements.
title('Checking the outside world (optional)');
const probes = [
  ['Ecoregion boundaries (EPA)', 'https://gispub.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer?f=json'],
  ['Watersheds (USGS)', 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer?f=json'],
  ['Live water data (USGS)', 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08155500&parameterCd=00060'],
  ['Neighbour discovery (Murmurations)', 'https://index.murmurations.network/v2/ping'],
];
for (const [label, url] of probes) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    r.ok ? ok(label) : warn(`${label} — reachable but unhappy (${r.status})`);
  } catch {
    warn(`${label} — cannot reach right now`);
    info('Not a problem: the OS keeps working offline using what it already downloaded.');
  } finally { clearTimeout(t); }
}

// AI
title('Assistant');
if (process.env.ANTHROPIC_API_KEY) ok('Built-in assistant is configured');
else {
  warn('Built-in assistant is not configured — this is completely optional');
  info('Either add ANTHROPIC_API_KEY to the .env file in this folder,');
  info('or skip it entirely and drive the OS from Claude Code instead:');
  cmd('npm run connect');
}

console.log(`\n  ${c.dim}${line()}${c.reset}`);
if (problems === 0) console.log(`  ${c.green}Everything that matters is working.${c.reset}\n`);
else if (FIX) console.log(`  Tried to fix ${problems} thing(s). Run npm run doctor again to confirm.\n`);
else console.log(`  ${problems} thing(s) need attention. Let it fix them for you:  ${c.blue}npm run doctor -- --fix${c.reset}\n`);
