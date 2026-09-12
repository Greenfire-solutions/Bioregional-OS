// ── The ground ────────────────────────────────────────────────────────────
// What the land is doing today, assembled for a person with sixty seconds.
//
// This engine exists because of one finding: across the largest study of
// citizen-science contributor motivation, 92% rated "improving my knowledge"
// as very or extremely important — above science, above recognition, above
// everything — and that held for newcomers and power users alike. So the thing
// that earns a second visit is not a task list. It is knowing something true
// about your place that you did not know yesterday.
//
// Everything here is read-only and gives before it asks. Nothing in it is a
// score, a streak or a count of the person's own activity.
import { all, one } from '../core/db.mjs';
import { skyToday } from '../adapters/sky.mjs';
import { weatherNow } from '../adapters/weather.mjs';
import { gageContext, waterSignals } from '../adapters/watershed.mjs';
import { humanObservedSql } from '../core/provenance.mjs';

/**
 * The place the chapter looks out from: an explicit one, else its first located place.
 *
 * LOAD-BEARING. Five tools across two engines answer bare — with no place_id —
 * by falling through to this: ground_today, soil_at, life_here, hazards_at and
 * anything else that means "here". A person asking the assistant "what is the
 * soil like here?" and "how is the creek?" gets a consistent answer only because
 * they all resolve the same way.
 *
 * The selection order is therefore part of the contract, not an implementation
 * detail, and `scripts/test.mjs` pins it:
 *   1. the place asked for, if it has coordinates;
 *   2. the best-resolved place in the chapter — watershed and ecoregion known
 *      first, then by name, so "here" means somewhere the OS can actually
 *      reason about rather than the most recently added row;
 *   3. the chapter's own centre, if it has one;
 *   4. nothing — and every caller must say so with the add_place action rather
 *      than failing.
 * Changing that order changes what "here" means in five places at once.
 */
export function anchorPlace(chapterId, placeId = null) {
  if (placeId) {
    const p = one('SELECT * FROM places WHERE id=?', placeId);
    if (p?.lat != null) return p;
  }
  const located = one(
    `SELECT * FROM places WHERE chapter_id=? AND lat IS NOT NULL
       ORDER BY (watershed_huc IS NULL), (ecoregion_name IS NULL), name LIMIT 1`, chapterId);
  if (located) return located;
  const c = one('SELECT * FROM chapters WHERE id=?', chapterId);
  if (c?.lat == null) return null;
  return { id: null, chapter_id: chapterId, name: c.name, lat: c.lat, lng: c.lng,
           ecoregion_name: null, watershed_name: null, watershed_huc: null };
}

/**
 * The gage a point watches — ONE implementation, used by the daily panel and by
 * the first run, because they were picking different creeks for the same place.
 *
 * The rule is: the nearest site that HAS a period of record to compare against.
 * A reading with history beats a closer reading without one, and it routes
 * around tidal gages, whose discharge reverses with the tide and carry no daily
 * statistics — "-993 ft³/s" is nobody's useful first sentence about their river.
 *
 * An earlier version preferred gages this chapter had already ingested. That
 * sounded like "the gage we watch" and was actually "whatever the bounding box
 * returned first", so the two callers disagreed about the same point. The rule
 * below depends only on the coordinate, so it always gives the same answer.
 */
export async function nearestGageContext(lat, lng) {
  const found = await waterSignals(lat, lng, { radiusDeg: 0.25 }).catch(() => []);
  const flowing = found.filter((s) => /discharge|streamflow/i.test(s.title));
  const candidates = (flowing.length ? flowing : found)
    .filter((s) => s.source_ref && s.lat != null)
    .sort((a, b) =>
      ((a.lat - lat) ** 2 + (a.lng - lng) ** 2) - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2));
  if (!candidates.length) return null;

  // Asked together — done one after another this was the slowest thing in the
  // first screen, and the first screen is the whole argument.
  const contexts = await Promise.all(candidates.slice(0, 3).map(async (c) => {
    const ctx = await gageContext(c.source_ref).catch(() => null);
    if (ctx) ctx.km_away = km(lat, lng, c.lat, c.lng);
    return ctx;
  }));
  return contexts.find((c) => c?.day_of_year_median != null) ?? contexts.find(Boolean) ?? null;
}

function km(y1, x1, y2, x2) {
  const R = 6371, r = Math.PI / 180;
  const dy = (y2 - y1) * r, dx = (x2 - x1) * r;
  const a = Math.sin(dy / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(dx / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/**
 * Stage 3 — Observe, for one human, right now.
 * Sky is computed locally and always answers. Weather and water are upstream
 * and may be stale or absent; each says so for itself rather than failing the
 * whole panel, because a commons tool that goes blank when the wifi drops is
 * not a commons tool.
 */
export async function groundToday(chapterId, { place_id = null } = {}) {
  const place = anchorPlace(chapterId, place_id);
  if (!place) {
    return {
      error: 'no_located_place',
      message: 'Add a place with coordinates — everything the land can tell you hangs off a point on it.',
      action: { tool: 'add_place', input: {} },
    };
  }

  const sky = skyToday(place.lat, place.lng);
  const [weather, water] = await Promise.all([
    weatherNow(place.lat, place.lng).catch((e) => ({ available: false, reason: e.message })),
    nearestGageContext(place.lat, place.lng).catch(() => null),
  ]);

  // A place can be heard. The card has carried this since it was built; the panel
  // a person actually opens every morning did not, which is the wrong way round.
  // Lazily imported so the panel still answers if the culture adapter is absent.
  let heard = null;
  try {
    const { soundsHere } = await import('../adapters/culture.mjs');
    const h = await soundsHere(place.lat, place.lng, { radiusKm: 15 });
    if (h?.available && typeof h.card_fact === 'string') {
      heard = {
        fact: h.card_fact,
        species_count: h.species_count ?? null,
        most_recent: h.most_recent ?? null,
        // Streamed from the upstream, never copied: nearly every recording is
        // NonCommercial, so the OS links and hosts nothing.
        source: h.source ?? 'iNaturalist',
        export_safe: h.export_safe === true,
      };
    }
  } catch { /* the panel is still worth opening without it */ }

  const out = {
    generated_at: new Date().toISOString(),
    place: {
      id: place.id, name: place.name, lat: place.lat, lng: place.lng,
      ecoregion: place.ecoregion_name, watershed: place.watershed_name, huc: place.watershed_huc,
    },
    sky, weather, water, heard,
    history: thisWeekInHistory(chapterId),
  };
  out.headline = headline(out);
  return out;
}

/**
 * One sentence, because most days nobody reads the second one.
 * Ordered by what would actually change a person's day: a hazard, then water
 * doing something unusual, then the season turning, then the light.
 */
function headline(g) {
  const alert = g.weather?.alerts?.[0];
  if (alert) return `${alert.event} in effect${alert.ends ? ` until ${short(alert.ends)}` : ''}.`;

  const w = g.water;
  if (w?.standing && !/about median/.test(w.standing)) {
    const name = w.site_name ?? 'The gage';
    const val = w.current === 0 ? 'dry' : `${fmt(w.current)} ${(w.unit ?? '').replace('ft3/s', 'ft\u00B3/s')}`.trim();
    return `${name} is ${val} — ${w.standing}${w.years_of_record ? `, over ${w.years_of_record} years of record` : ''}.`;
  }

  const turn = g.sky?.next_turn;
  if (turn && turn.days_away <= 7) return `The ${turn.name} is in ${turn.days_away} day${turn.days_away === 1 ? '' : 's'}.`;

  if (g.sky?.daylight) {
    return `${g.sky.daylight} of daylight, ${g.sky.daylight_change}.`;
  }
  return 'The land is quiet today.';
}

/**
 * Mechanic 3 — what this week held in earlier years.
 * The archive is the one thing a local-first commons has that no cloud service
 * does, and it is the honest replacement for a streak: consistency shows up as
 * a record of the place, with nothing to break and no penalty for missing a week.
 */
export function thisWeekInHistory(chapterId, { window_days = 3 } = {}) {
  // Day-of-year distance, wrapping at the new year, so late December still
  // finds early January.
  const near = (col) =>
    `min(abs(cast(strftime('%j', ${col}) as integer) - cast(strftime('%j','now') as integer)),
         365 - abs(cast(strftime('%j', ${col}) as integer) - cast(strftime('%j','now') as integer))) <= ?`;
  const priorYear = (col) => `cast(strftime('%Y', ${col}) as integer) < cast(strftime('%Y','now') as integer)`;

  const obs = all(
    `SELECT title, category, severity, author, quantity_value, quantity_unit,
            coalesce(observed_at, created_at) at
       FROM signals
      WHERE chapter_id=? AND coalesce(observed_at, created_at) IS NOT NULL
        -- Every adapter writes into this table. Only what a PERSON noticed
        -- belongs in the chapter's memory of the season; an excluded list would
        -- have to be updated by every new adapter, so the rule names the human
        -- sources instead. See core/provenance.mjs.
        AND ${humanObservedSql('source_adapter')}
        AND ${priorYear('coalesce(observed_at, created_at)')}
        AND ${near('coalesce(observed_at, created_at)')}
      ORDER BY at DESC LIMIT 12`, chapterId, window_days);

  const decisions = all(
    `SELECT title, method, status, coalesce(decided_at, created_at) at
       FROM decisions
      WHERE chapter_id=? AND ${priorYear('coalesce(decided_at, created_at)')}
        AND ${near('coalesce(decided_at, created_at)')}
      ORDER BY at DESC LIMIT 6`, chapterId, window_days);

  const gatherings = all(
    `SELECT title, kind, starts_at at FROM gatherings
      WHERE chapter_id=? AND starts_at IS NOT NULL
        AND ${priorYear('starts_at')} AND ${near('starts_at')}
      ORDER BY at DESC LIMIT 6`, chapterId, window_days);

  const items = [
    ...obs.map((o) => ({ kind: 'observation', ...o })),
    ...decisions.map((d) => ({ kind: 'decision', ...d })),
    ...gatherings.map((g) => ({ kind: 'gathering', ...g })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const earliest = one(
    `SELECT min(created_at) t FROM signals WHERE chapter_id=?`, chapterId)?.t ?? null;
  const yearsHeld = earliest
    ? Math.floor((Date.now() - new Date(String(earliest).replace(' ', 'T')).getTime()) / (365.25 * 86400000))
    : 0;

  return {
    window_days,
    items,
    years_of_record: yearsHeld,
    // Year one is empty and should say so, with the date it stops being empty.
    note: items.length ? null
      : yearsHeld >= 1
        ? 'Nothing was recorded near this date in earlier years.'
        : `This fills in from ${new Date(Date.now() + 365 * 86400000).getFullYear()} — it needs a year of your own records first.`,
  };
}

const fmt = (n) => (n == null ? '' : n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));
const short = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};
