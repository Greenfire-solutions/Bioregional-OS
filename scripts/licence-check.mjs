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

const ADAPTERS = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters');

const LICENCE = /CC-?BY[A-Za-z0-9.\-]*|CC0[A-Za-z0-9.\-]*|\bODbL\b[A-Za-z0-9.\-]*|Public domain|GPL-[0-9.]+|Apache-[0-9.]+/;

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
export const ALLOWED = new Set(['registry.mjs', 'discover.mjs']);

/** Strip comments: documenting an upstream's licence in prose is good practice. */
function executableLines(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map((l) => {
    const i = l.indexOf('//');
    return i >= 0 ? l.slice(0, i) : l;
  });
}

export function findDuplications() {
  const out = [];
  for (const file of readdirSync(ADAPTERS).filter((f) => f.endsWith('.mjs'))) {
    if (ALLOWED.has(file)) continue;
    const lines = executableLines(readFileSync(join(ADAPTERS, file), 'utf8'));
    lines.forEach((line, i) => {
      if (ATTRIBUTION_FIELD.test(line) && LICENCE.test(line)) {
        out.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
      }
    });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('licence-check.mjs')) {
  const hits = findDuplications();
  if (!hits.length) console.log('\n  No adapter duplicates a licence the registry already declares.\n');
  else {
    console.log(`\n  ${hits.length} licence string(s) outside the registry:\n`);
    for (const h of hits) console.log(`  ${h.file}:${h.line}\n     ${h.text}`);
    console.log('\n  Carry source_id instead; attributionFor() renders the credit.\n');
  }
  process.exit(hits.length ? 1 : 0);
}
