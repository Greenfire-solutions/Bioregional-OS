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
import { msSince } from '../core/time.mjs';
import { skyToday } from '../adapters/sky.mjs';
import { weatherNow } from '../adapters/weather.mjs';
import { gageContext, waterSignals } from '../adapters/watershed.mjs';
import { humanObservedSql } from '../core/provenance.mjs';
import { attributionFor, source as registrySource } from '../adapters/registry.mjs';

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
    // Scoped to the chapter. Unscoped, `place_id` was a way to look out from
    // ANY place in the database — and `ground_today` takes both `chapter_id`
    // and `place_id` in its schema and is now reachable at public, so a
    // stranger could name another chapter's place and be answered about it.
    // A caller that may not read a chapter may not stand in it either.
    const p = one('SELECT * FROM places WHERE id=? AND chapter_id=?', placeId, chapterId);
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
        source_id: h.source_id ?? 'inaturalist',
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
  // Resolved once here so every surface that prints the panel — the screen, the
  // field sheet, anything later — credits the same sources the same way.
  const ids = [weather?.source_id, water?.source_id, heard?.source_id].filter(Boolean);
  const unknown = ids.filter((i) => !registrySource(i));
  out.sources = attributionFor(ids.filter((i) => registrySource(i)));
  out.unresolved_sources = unknown;
  out.credit = [
    out.sources.map((r) => r.attribution || r.source).filter(Boolean).join(' · '),
    unknown.length ? `Also drawn from: ${unknown.join(', ')} — check their terms before sharing further.` : null,
  ].filter(Boolean).join(' ') || null;

  out.headline = headline(out);
  return out;
}

/**
 * The day clock, for somebody who is not a member of this commons.
 *
 * DAILY_USE.md §4 specifies the day clock as "60 seconds, ANYONE: the app must
 * tell you something true about your place you didn't know. It gives before it
 * asks." As shipped it gave nothing: every read in the system was members-only
 * and the four public tools were all WRITES, so a stranger handed a link could
 * contribute and could not look. That is inverted from how people actually use
 * community software — the 90 in 90-9-1 participate BY READING, and most
 * lurkers report that browsing is their participation rather than a stage
 * before it.
 *
 * An ALLOWLIST, not a redaction, and that is the whole point: a field added to
 * groundToday() later does not quietly become public because somebody forgot
 * this function exists. Fail closed means new things are private until named.
 *
 * What is deliberately not here:
 *
 *   place.lat / place.lng   `list_places` is members-only on purpose. A place
 *                           NAME is a fact about the land; a coordinate is a
 *                           direction to it. The day clock needs the first.
 *   place.id                an id is a handle for asking about a thing by id.
 *   history                 the chapter's OWN records. Everything else here is
 *                           the sky, the weather, the gage and an upstream
 *                           species feed — public data about a public place.
 *                           The chapter's observations are the commons'.
 *
 * `withhold()` in server/clearance.mjs still runs over the result, so a place
 * whose RID is above public is removed entirely on the way out. This function
 * is the first of the two, not a replacement for it: withhold protects what was
 * MARKED sensitive, and today every RID is minted `public` by default, so a
 * projection that fails closed by construction is the one doing the work.
 */
/**
 * What this answer looks like to a given connection.
 *
 * Two rules, and the first applies at EVERY clearance rather than only to
 * strangers, because it is not about audiences — it is about what is left in an
 * answer once its subject has been removed.
 */
export function groundSeenBy(g, clearance) {
  if (!g || typeof g !== 'object' || g.error) return g;
  // Rule one: the subject was withheld, so the rest is locators. A member whose
  // connection is not allowed the place is not allowed the gage that watches it
  // either — withhold() removes the place object and leaves the gage, the
  // weather station and the solar times sitting there, and those are a location.
  if (!g.place) return noPublicPlace();
  // Rule two: a stranger gets the day clock and nothing else.
  return clearance === 'public' ? forAStranger(g) : g;
}

const noPublicPlace = () => ({
  error: 'nothing_public_here',
  message: 'This commons has not published anything about where it is.',
});

export function forAStranger(g) {
  if (!g || typeof g !== 'object' || g.error) return g;

  // If the place was WITHHELD, there is no public day clock here at all.
  //
  // Everything else in this panel is a locator for that place. A USGS site
  // number resolves to exact coordinates through a public API; a weather
  // station is a named airfield; sunrise, sunset and solar noon together solve
  // for latitude and longitude to within a few kilometres. Returning "the land"
  // while omitting the place name would be the same disclosure with an extra
  // step, and this project's rule for a sensitive record is that it is named
  // and counted, never LOCATED.
  //
  // withhold() runs before this (see runTool) and removes the place object
  // outright, so its absence here means protected, not missing.
  if (!g.place) return noPublicPlace();

  return {
    generated_at: g.generated_at,
    place: g.place ? {
      name: g.place.name,
      ecoregion: g.place.ecoregion,
      watershed: g.place.watershed,
    } : null,
    sky: g.sky,
    weather: g.weather,
    water: g.water,
    heard: g.heard,
    headline: g.headline,
    sources: g.sources,
    unresolved_sources: g.unresolved_sources,
    credit: g.credit,
    for_a_stranger: true,
  };
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
    ? Math.floor((msSince(earliest) ?? 0) / (365.25 * 86400000))
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
