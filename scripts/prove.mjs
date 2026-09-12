#!/usr/bin/env node
// ── Press every button ────────────────────────────────────────────────────
//
//   npm run prove              → against a fresh seeded commons, safe, default
//   npm run prove -- --live    → against a COPY of your real commons, also safe
//
// The test suite proves the protocol REFUSES. This proves the app RESPONDS:
// that every tool in the registry actually runs, every REST route answers,
// every control the interface offers reaches something, and nothing anywhere
// falls through to a raw exception.
//
// The distinction it is built around, and the only interesting one here:
//
//   A REFUSAL IS A PASS. `missing_required`, `not_found`, `no_chapter`,
//   `review_incomplete` — these are the system working. A tool that refuses
//   cleanly and says why is doing its job.
//
//   A CRASH IS A FAILURE. A raw SQLite message, a TypeError, "undefined is not
//   a function" — anything that escaped as an exception rather than being
//   turned into an answer a caller can act on. That is the class of thing that
//   makes a button do nothing, and it is invisible from the outside because the
//   screen simply does not change.
//
// Everything is exercised against a THROWAWAY database — either built by the
// seed the app ships, or, with --live, a VACUUM INTO copy of your real commons
// so the prover meets your actual data. Either way the writes are real writes
// and land on a file that is deleted at the end.
//
// --live used to mean "skip the seeding", which left every tool — including
// every write — running against the real commons. It read as read-only in the
// header and was not, which is the most dangerous shape a flag can have. It
// copies now, and the guard below refuses to run against anything that is not
// the copy.
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = process.argv.includes('--live');
const VERBOSE = process.argv.includes('--verbose');

const dir = mkdtempSync(join(tmpdir(), 'bros-prove-'));
const target = join(dir, 'prove.db');

// With --live, copy the real commons FIRST — via VACUUM INTO, because a file
// copy of a WAL database is short by whatever has not been checkpointed — and
// then point everything at the copy. The real one is opened read-only, once,
// and closed before anything else runs.
if (LIVE) {
  const { DatabaseSync } = await import('node:sqlite');
  const live = process.env.BROS_DB || join(new URL('..', import.meta.url).pathname, 'data', 'commons.db');
  const src = existsSync(live) ? live
    : fileURLToPath(new URL('../data/commons.db', import.meta.url));
  if (!existsSync(src)) {
    console.error(`\n  No commons to copy at ${src}\n`);
    process.exit(2);
  }
  const d = new DatabaseSync(src, { readOnly: true });
  d.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  d.close();
  console.log(`  copied your commons to a throwaway — the original is untouched`);
}
process.env.BROS_DB = target;

// Seeded in a SUBPROCESS, before this process opens the file. core/seed.mjs is
// a script rather than a module — it runs on import and closes the database at
// the end — so importing it here would hand back a closed handle, and the first
// query would fail in a way that looked like a bug in the thing being proved.
if (!LIVE) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath,
    // fileURLToPath, not .pathname. This project lives under "Main projects"
    // and a URL pathname keeps the space percent-encoded, so the child was
    // handed a file that does not exist — the same trap scripts/lib.mjs's
    // isMain() exists for.
    ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../core/seed.mjs', import.meta.url))],
    { env: { ...process.env, BROS_DB: process.env.BROS_DB }, stdio: 'ignore' });
}

const { all, one, openPath, db } = await import('../core/db.mjs');
db();
if (!/bros-prove/.test(openPath())) {
  console.error(`\n  REFUSING TO RUN: would exercise ${openPath()}\n`);
  process.exit(2);
}

const { TOOLS, runTool } = await import('../ai/tools.mjs');
const { api } = await import('../server/routes/api.mjs');

const chapterId = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;

// ── What a tool needs, filled from the database it is being run against ────
// A tool that requires an id cannot be proved by passing nothing — it would
// refuse for the right reason and tell us nothing about whether it works. So
// required ids are resolved to real rows, and only what genuinely cannot be
// resolved is left out.
const ID = {
  chapter_id: () => chapterId,
  place_id: () => one('SELECT id FROM places WHERE chapter_id=?', chapterId)?.id,
  quest_id: () => one('SELECT id FROM quests WHERE chapter_id=?', chapterId)?.id,
  signal_id: () => one('SELECT id FROM signals WHERE chapter_id=?', chapterId)?.id,
  decision_id: () => one('SELECT id FROM decisions WHERE chapter_id=?', chapterId)?.id,
  intake_id: () => one('SELECT id FROM intake WHERE chapter_id=?', chapterId)?.id,
  indicator_id: () => one('SELECT id FROM indicators WHERE chapter_id=?', chapterId)?.id,
  gathering_id: () => one('SELECT id FROM gatherings WHERE chapter_id=?', chapterId)?.id,
  dataset_id: () => one('SELECT id FROM discovered_datasets WHERE chapter_id=?', chapterId)?.id,
  hub_id: () => one('SELECT id FROM hubs WHERE chapter_id=?', chapterId)?.id,
  code: () => '30c',
  rid: () => one('SELECT rid FROM rids WHERE chapter_id=?', chapterId)?.rid,
  query: () => 'oak',
  subject: () => 'water',
  lat: () => 30.26,
  lng: () => -97.79,
  title: () => 'Proving the buttons',
  name: () => 'Proving the buttons',
  body: () => 'Raised by the prover.',
  purpose: () => 'Proving that every control answers.',
  human_reviewer: () => 'The prover',
  gate: () => 'land_access',
  evidence: () => 'Recorded by the prover.',
  reviewed_by: () => 'The prover',
  response: () => 'Acknowledged by the prover.',
  value: () => 1,
  to_stage: () => 'listening',
  resolution: () => 'Resolved by the prover.',
  resolved_by: () => 'The prover',
  summary: () => 'Written by the prover.',
  land_seat_report: () => 'Prover: creek low, banks exposed, uncertainty on recovery.',
  // A real file, so the import path is actually exercised rather than proved to
  // refuse a name that was never going to exist.
  path: () => geojsonFixture,
};

// One valid FeatureCollection on disk, in the throwaway directory.
const geojsonFixture = join(dir, 'prover.geojson');
writeFileSync(geojsonFixture, JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-97.79, 30.26] },
    properties: { title: 'Prover observation', category: 'Ecological' },
  }],
}));

function inputFor(t) {
  const props = t.input_schema?.properties ?? {};
  const req = t.input_schema?.required ?? [];
  const input = {};
  if ('chapter_id' in props && chapterId) input.chapter_id = chapterId;
  for (const k of req) {
    if (ID[k]) { const v = ID[k](); if (v !== undefined && v !== null) input[k] = v; continue; }
    const spec = props[k] ?? {};
    if (Array.isArray(spec.enum)) input[k] = spec.enum[0];
    else if (spec.type === 'number') input[k] = 1;
    else if (spec.type === 'boolean') input[k] = false;
    else if (spec.type === 'array') input[k] = [];
    else input[k] = `prover-${k}`;
  }
  return input;
}

// ── Telling a refusal from a crash ─────────────────────────────────────────
// A structured refusal has a machine-readable code this project chose. A crash
// arrives as whatever the runtime said. The list is of the SHAPES a refusal
// takes, not of every code, so a new refusal is a pass by default and a new
// exception is a failure by default — which is the direction that fails safe.
const CRASH = /is not a function|undefined is not|cannot read propert|SQLITE_|CHECK constraint|no such (table|column)|unexpected token|circular structure|maximum call stack/i;

function classify(out) {
  if (out === undefined || out === null) return ['crash', 'returned nothing at all'];
  if (typeof out !== 'object') return ['ok', ''];
  if (!out.error) return ['ok', ''];
  const msg = `${out.error} ${out.message ?? ''}`;
  if (CRASH.test(msg)) return ['crash', msg.slice(0, 120)];
  // An error whose code is a whole sentence is an exception that was caught and
  // passed through rather than turned into an answer.
  if (!out.message && /\s/.test(String(out.error)) && String(out.error).length > 60) {
    return ['crash', String(out.error).slice(0, 120)];
  }
  return ['refused', String(out.error)];
}

// Tools that reach the network. Exercised, but a timeout or an upstream being
// down is not this app being broken, so they are reported apart.
const UPSTREAM = /^(discover_local_data|discover_peers|publish_to_murmurations|ingest_water_data|locate_place|hazards_here|life_here|soil_at|community_here|growing_year|water_quality|download_region|look_around|ground_today|this_week_last_year|validate_murmurations|koi_sync|begin_here|add_place)$/;

const rows = [];
for (const t of TOOLS) {
  const started = Date.now();
  let out, threw = null;
  try {
    out = await runTool(t.name, inputFor(t));
  } catch (e) {
    threw = e;
  }
  const ms = Date.now() - started;
  if (threw) rows.push([t.name, 'threw', `${threw.message}`.slice(0, 120), ms]);
  else {
    const [state, why] = classify(out);
    rows.push([t.name, UPSTREAM.test(t.name) && state !== 'ok' ? 'upstream' : state, why, ms]);
  }
}

// ── The REST surface ───────────────────────────────────────────────────────
const ROUTES = [...new Set(
  (await import('node:fs')).readFileSync(new URL('../server/routes/api.mjs', import.meta.url), 'utf8')
    .match(/case '([a-z0-9/_-]+)':/g)?.map((m) => m.slice(6, -2)) ?? [])];

const routeRows = [];
for (const p of ROUTES) {
  const req = { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const res = { writeHead() {}, end() {}, write() {} };
  const url = new URL(`http://localhost/api/${p}`);
  try {
    const out = await api(req, res, url);
    routeRows.push([p, out === undefined ? 'streamed' : (out?.error ? 'refused' : 'ok'),
                    out?.error ? String(out.error).slice(0, 60) : '']);
  } catch (e) {
    routeRows.push([p, 'threw', `${e.message}`.slice(0, 90)]);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const count = (s) => rows.filter((r) => r[1] === s).length;
const broken = rows.filter((r) => r[1] === 'threw' || r[1] === 'crash');
const routeBroken = routeRows.filter((r) => r[1] === 'threw');

console.log(`\n  Pressing every button${LIVE ? ' (against a copy of your commons)' : ''}`);
console.log(`  ${'─'.repeat(66)}`);
for (const [name, state, why, ms] of rows) {
  if (state === 'ok' && !VERBOSE) continue;
  const col = state === 'ok' ? c.g : state === 'refused' ? c.d : state === 'upstream' ? c.y : c.r;
  const mark = state === 'ok' ? '✓' : state === 'refused' ? '·' : state === 'upstream' ? '~' : '✗';
  console.log(`  ${col}${mark}${c.x} ${name.padEnd(28)} ${c.d}${state}${why ? ` — ${why}` : ''}${c.x}`);
}
console.log(`  ${'─'.repeat(66)}`);
console.log(`  ${count('ok')} ran · ${count('refused')} refused cleanly · ${count('upstream')} need an upstream · ` +
            `${broken.length} broken`);
console.log(`  routes: ${routeRows.filter((r) => r[1] === 'ok').length} answered · ` +
            `${routeRows.filter((r) => r[1] === 'refused').length} refused · ${routeBroken.length} broken`);
for (const [p, , why] of routeBroken) console.log(`    ${c.r}✗${c.x} /api/${p} — ${why}`);
console.log();

rmSync(dir, { recursive: true, force: true });
process.exit(broken.length + routeBroken.length ? 1 : 0);
