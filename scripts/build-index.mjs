#!/usr/bin/env node
// Builds the region index: every ecoregion, its hierarchy, extent and centre.
// Small enough to ship with the repository and to work entirely offline.
//   npm run data -- --build-index
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, title, ok, info, isMain, c } from './lib.mjs';
import { getJSON, qs } from '../adapters/http.mjs';

const EPA = 'https://gispub.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/7/query';
const PAGE = 120;

export async function buildIndex({ log = true } = {}) {
  if (log) title('Building the ecoregion index');
  const regions = new Map();
  let offset = 0, pages = 0;

  for (;;) {
    const url = `${EPA}?${qs({
      where: '1=1',
      outFields: 'US_L4CODE,US_L4NAME,US_L3CODE,US_L3NAME,NA_L2NAME,NA_L1NAME,STATE_NAME',
      returnGeometry: true,
      maxAllowableOffset: 0.06,      // coarse — we only need extents from this
      outSR: 4326,
      resultOffset: offset,
      resultRecordCount: PAGE,
      f: 'geojson',
    })}`;
    const { data } = await getJSON(url, { ttlMs: 1000 * 60 * 60 * 24 * 180, timeout: 90000 });
    const feats = data?.features ?? [];
    if (!feats.length) break;

    for (const f of feats) {
      const p = f.properties ?? {};
      const code = p.US_L4CODE;
      if (!code) continue;
      const bb = bbox(f.geometry);
      if (!bb) continue;
      const prev = regions.get(code);
      regions.set(code, prev ? { ...prev, bbox: merge(prev.bbox, bb),
                                 states: [...new Set([...prev.states, p.STATE_NAME].filter(Boolean))] }
                             : {
        scheme: 'epa-l4',
        code,
        name: p.US_L4NAME,
        level3_code: p.US_L3CODE,
        level3_name: p.US_L3NAME,
        division: title_case(p.NA_L2NAME),
        biome: title_case(p.NA_L1NAME),
        states: [p.STATE_NAME].filter(Boolean),
        bbox: bb,
      });
    }
    offset += feats.length; pages++;
    if (log && pages % 2 === 0) info(`  ${offset} polygons read…`);
    if (feats.length < PAGE) break;
    if (offset > 20000) break;                        // hard stop; the service has ~11k parts
  }

  const list = [...regions.values()].map((r) => ({
    ...r,
    centroid: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2],
    span_deg: Number(Math.max(r.bbox[2] - r.bbox[0], r.bbox[3] - r.bbox[1]).toFixed(3)),
  })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Level III rolls up from Level IV.
  const l3 = new Map();
  for (const r of list) {
    const prev = l3.get(r.level3_code);
    l3.set(r.level3_code, prev
      ? { ...prev, bbox: merge(prev.bbox, r.bbox), children: [...prev.children, r.code],
          states: [...new Set([...prev.states, ...r.states])] }
      : { scheme: 'epa-l3', code: r.level3_code, name: r.level3_name,
          division: r.division, biome: r.biome, states: r.states,
          bbox: r.bbox, children: [r.code] });
  }
  const l3list = [...l3.values()].map((r) => ({
    ...r, centroid: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2],
  })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const out = {
    built_at: new Date().toISOString(),
    source: 'EPA Ecoregions Level III & IV',
    // The terms live in adapters/registry.mjs and are resolved from this id.
    // This file used to bake "(public domain)" into the line above, and the
    // index it writes is TRACKED — so the one copy of a licence outside the
    // registry that was world-readable was the one the checker could not see,
    // because the checker only walked adapters/.
    source_id: 'epa-ecoregions',
    source_url: 'https://www.epa.gov/eco-research/ecoregions',
    note: 'Extents are coarse (simplified geometry) and are used to scope data queries, ' +
          'not to draw boundaries. The map draws live, precise polygons.',
    counts: { level3: l3list.length, level4: list.length },
    level3: l3list,
    level4: list,
  };
  mkdirSync(join(ROOT, 'data', 'regions'), { recursive: true });
  const path = join(ROOT, 'data', 'regions', 'ecoregions-epa.json');
  writeFileSync(path, JSON.stringify(out));
  if (log) {
    ok(`${list.length} Level IV and ${l3list.length} Level III ecoregions indexed`);
    info(`${path.replace(ROOT + '/', '')} — ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
  }
  return out;
}

function bbox(geom) {
  if (!geom) return null;
  let minX = 180, minY = 90, maxX = -180, maxY = -90, seen = false;
  (function walk(a) {
    if (typeof a[0] === 'number') {
      seen = true;
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    } else for (const b of a) walk(b);
  })(geom.coordinates ?? []);
  return seen ? [round(minX), round(minY), round(maxX), round(maxY)] : null;
}
const round = (n) => Number(n.toFixed(4));
const merge = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const title_case = (s) => s ? s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : s;

if (isMain(import.meta.url)) await buildIndex();
