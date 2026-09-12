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

// ── What this commons can actually reach ──────────────────────────────────
// Reads the upstream registry rather than a second list of sources kept here.
// Two different questions, and they are not the same question:
//   • DECLARED — which open data sources exist, and under what licence. Known
//     without touching the network.
//   • ANSWERED — which have actually replied on this computer. That is evidence,
//     not configuration, and it is the one a person wants when something looks
//     empty and they cannot tell whether it is broken or just untried.
title('The open data this commons can reach');
{
  const { SOURCES, missingKeys } = await import('../adapters/registry.mjs');
  const rows = existsSync(dbFile)
    ? (await import('../core/db.mjs')).all('SELECT id, last_fetched_at FROM upstream_sources')
    : [];
  const fetched = new Map(rows.map((r) => [r.id, r.last_fetched_at]));
  const declared = SOURCES.length;
  const answered = SOURCES.filter((s) => fetched.get(s.id));
  const untried = SOURCES.filter((s) => fetched.has(s.id) && !fetched.get(s.id));
  const undeclared = SOURCES.filter((s) => !fetched.has(s.id));
  const needKeys = missingKeys();

  ok(`${declared} sources declared · ${answered.length} have answered on this computer`);

  if (undeclared.length) {
    warn(`${undeclared.length} source(s) are not written into your database yet`);
    info('They appear the first time the OS starts. Nothing is lost meanwhile.');
  }
  if (untried.length) {
    info(`${untried.length} never tried yet: ${untried.slice(0, 6).map((s) => s.name).join(', ')}` +
         (untried.length > 6 ? ` and ${untried.length - 6} more` : ''));
    info('Not a problem — most are asked once, the first time a place needs them.');
  }

  const stale = answered.filter((s) => {
    const t = Date.parse(String(fetched.get(s.id)).replace(' ', 'T') + 'Z');
    return Number.isFinite(t) && Date.now() - t > 30 * 86400000;
  });
  if (stale.length) {
    warn(`${stale.length} source(s) have not answered in over a month`);
    info(stale.map((s) => s.name).join(', '));
    cmd('npm run update');
  }

  for (const k of needKeys) {
    warn(`${k.name} needs a key you do not have`);
    info(`It is free. Get one, then add ${k.env_var}=... to the .env file in this folder.`);
    info('Everything else works without it.');
  }
}

// ── Can it reach them right now ───────────────────────────────────────────
// Every probe is declared in the registry alongside the source it belongs to,
// so there is no second list of endpoints here to drift out of date.
//
// Three outcomes, and all three have to be distinguishable. "Answering",
// "cannot reach", and "cannot be checked at all" are different facts, and a
// report that shows only the first two makes "needs a key you do not have" look
// identical to "we forgot about this one".
//
// HTTP 200 is not proof. Two of these answer 200 while completely broken — MRLC
// returns an XML exception report for a bad layer, and the Drought Monitor
// returns CSV when content negotiation fails. Where the registry declares an
// `expect` string, the body has to contain it.
title('Checking the outside world (optional)');
{
  const { probes } = await import('../adapters/registry.mjs');
  const { probeable, unprobeable } = probes();

  const results = await Promise.all(probeable.map(async (p) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await fetch(p.url, {
        method: p.method, body: p.body ?? undefined, signal: ac.signal,
        headers: { 'user-agent': 'BioRegional-OS/1.0 (+AGPL)', ...p.headers },
      });
      if (!res.ok) return { ...p, state: 'unhappy', detail: `${res.status} ${res.statusText}` };
      if (!p.expect) return { ...p, state: 'ok' };
      const body = await res.text();
      return body.includes(p.expect)
        ? { ...p, state: 'ok' }
        : { ...p, state: 'wrong', detail: `answered, but not with what the adapter reads` };
    } catch {
      return { ...p, state: 'unreachable' };
    } finally { clearTimeout(t); }
  }));

  const answering = results.filter((r) => r.state === 'ok');
  ok(`${answering.length} of ${results.length} checked sources are answering`);

  for (const r of results.filter((r) => r.state !== 'ok')) {
    if (r.state === 'unreachable') {
      warn(`${r.name} — cannot reach right now`);
      info('Not a problem: the OS keeps working offline using what it already downloaded.');
    } else if (r.state === 'wrong') {
      // The dangerous one. Loud here so it cannot be quiet downstream.
      warn(`${r.name} — answering, but not with what the adapter reads`);
      info(`Expected to find "${r.expect}" in the reply and did not. The service may have changed.`);
      problems++;
    } else {
      warn(`${r.name} — reachable but unhappy (${r.detail})`);
    }
  }

  if (unprobeable.length) {
    info(`${unprobeable.length} cannot be health-checked, which is not the same as failing:`);
    for (const u of unprobeable) info(`  ${u.name} — ${u.why}`);
  }
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
