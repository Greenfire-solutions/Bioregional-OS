// ── Licence duplication check ─────────────────────────────────────────────
// registry.mjs is the one place a source's licence is declared. This asserts
// the property rather than the mechanism: no adapter may put licence text into
// a value it RETURNS. Carry `source_id` and let attributionFor() render credit.
//
// Why the property and not a grep for new SOURCES entries: an adapter can break
// this rule without touching the registry at all, by typing the licence into a
// string it hands back. That is how it was broken in adapters/dossier.mjs, and a
// structural check could not see it.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = join(ROOT, 'adapters');

// The `i` is the whole check.
//
// Without it this pattern matched "Public domain" and every adapter in the repo
// writes "(public domain)" in lower case — so for as long as this file has
// existed it printed "No adapter duplicates a licence the registry already
// declares" while twenty-two attribution fields carried licence text. It was
// written after fourteen real duplications and it never saw the next twenty-two.
//
// The same shape as the count guard next door, twice over: a guard that works on
// the exact instance that motivated it and is one mutation away from silence.
// Assert the property, not the spelling.
const LICENCE = /CC[\s-]?BY[A-Za-z0-9.\s\-]*|CC0[A-Za-z0-9.\-]*|\bODb?C?-?BY?\b[A-Za-z0-9.\-]*|Public domain|Open Government Licence|GPL-[0-9.]+|Apache-[0-9.]+/i;

/**
 * Only attribution FIELDS are checked — the machine-readable ones that travel
 * into a file or a UI. Explaining an upstream's licence to a person in prose is
 * not a declaration and is often the right thing to do; culture.mjs telling a
 * steward why recordings are linked rather than copied is an example.
 */
const ATTRIBUTION_FIELD = /\b(source|attribution|licen[cs]e)\s*:/;

/**
 * Two files are allowed to name licences in code, for opposite reasons.
 *   registry.mjs  — it IS the declaration. Everywhere else reads from it.
 *   discover.mjs  — classifyLicense() parses licence text found on third-party
 *                   portals into a code. It consumes licences; it declares none.
 */
export const ALLOWED = new Set([
  'registry.mjs',   // it IS the declaration. Everywhere else reads from it.
  'discover.mjs',   // classifyLicense() consumes licence text; it declares none.
  // Widening the scope beyond adapters/ surfaced two more lines that name a
  // licence legitimately, and they are worth naming rather than pattern-matching
  // away, because each is a DIFFERENT concept from the one this file polices.
  'test.mjs',       // fixtures. The suite passes a licence INTO setBaseline as
                    // caller-supplied input; being able to write one is the point.
  'seed.mjs',       // `learn.license` is the licence of the commons' OWN
                    // published work, CC-BY-SA-4.0, which a chapter declares for
                    // itself. That is not a copy of an upstream's terms, and
                    // treating it as one would forbid a commons from licensing
                    // what it wrote.
]);

/** Strip comments: documenting an upstream's licence in prose is good practice. */
function executableLines(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map((l) => {
    const i = l.indexOf('//');
    return i >= 0 ? l.slice(0, i) : l;
  });
}

/**
 * Where a licence could be written down. NOT just adapters/ — that scope was
 * itself the bug.
 *
 * `scripts/build-index.mjs` baked "EPA Ecoregions Level III & IV (public
 * domain)" into `data/regions/ecoregions-epa.json`, which is TRACKED and so
 * world-readable, two files from the adapters this checker was cleaning. The
 * rule is "a licence is written in registry.mjs and nowhere else"; enforcing it
 * by directory enforces something narrower than the rule, and the gap is
 * invisible because the check goes green.
 *
 * The built index is scanned as well as its builder, because the string in the
 * artefact outlives the line that wrote it: fixing the generator does nothing
 * to the file already committed.
 */
const SCOPE = [
  { dir: ADAPTERS, label: 'adapters' },
  { dir: join(ROOT, 'scripts'), label: 'scripts' },
  { dir: join(ROOT, 'engines'), label: 'engines' },
  { dir: join(ROOT, 'core'), label: 'core' },
  { dir: join(ROOT, 'data', 'regions'), label: 'data/regions', ext: /\.json$/ },
];

export function findDuplications() {
  const out = [];
  for (const { dir, label, ext } of SCOPE) {
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (ALLOWED.has(f) || f === 'licence-check.mjs') continue;
      const isJson = (ext ?? /\.mjs$/) === ext;
      if (!(ext ?? /\.mjs$/).test(f)) continue;
      const raw = readFileSync(join(dir, f), 'utf8');
      // JSON has no comments to strip, and every string in it is data that
      // travels — so every line of it is checked, not only assignments.
      const lines = isJson ? raw.split('\n') : executableLines(raw);
      lines.forEach((line, i) => {
        if ((isJson || ATTRIBUTION_FIELD.test(line)) && LICENCE.test(line)) {
          out.push({ file: `${label}/${f}`, line: i + 1, text: line.trim().slice(0, 120) });
        }
      });
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('licence-check.mjs')) {
  const hits = findDuplications();
  if (!hits.length) console.log('\n  Nothing outside the registry declares a licence.\n');
  else {
    console.log(`\n  ${hits.length} licence string(s) outside the registry:\n`);
    for (const h of hits) console.log(`  ${h.file}:${h.line}\n     ${h.text}`);
    console.log('\n  Carry source_id instead; attributionFor() renders the credit.\n');
  }
  process.exit(hits.length ? 1 : 0);
}
