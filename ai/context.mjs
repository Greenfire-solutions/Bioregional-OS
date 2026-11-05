// ── Where the assistant is standing ───────────────────────────────────────
// The prompt used to carry one fact about the place: the chapter's name. It
// described the protocol in detail and the ground in none, so every
// conversation opened cold — the model had to guess that a question about a
// creek was a question about THIS creek, in a particular ecoregion, with a
// particular gage on it and particular things living in it.
//
// Nothing else in this OS works that way. The Today tab leads with the land,
// the Land Seat puts the readings in front of the council, and the whole
// argument of docs/DAILY_USE.md is that the app must give before it asks. The
// assistant was the one surface still asking first.
//
// Everything here is read from disk at the moment the question is asked:
// the chapter's own rows, the ecoregion dossier already compiled, and NOAA's
// solar equations computed on this machine. No network call, so a conversation
// works on a laptop in a field with the wifi off — which is where a good number
// of these questions get asked.
//
// It stays deliberately SHORT. This is orientation, not a data dump: enough
// that the assistant knows which place it is in and reaches for the right tool,
// never so much that it answers from the prompt instead of from a tool. The
// tools remain the only source of a claim.
import { all, one } from '../core/db.mjs';
import { brief as landSeatBrief } from '../engines/landseat.mjs';
import { myRegions, brief as regionBrief } from '../engines/library.mjs';

/** Facts about the ground, gathered offline, for the standing prompt. */
export function placeContext(chapterId) {
  if (!chapterId) return null;
  const chapter = one('SELECT * FROM chapters WHERE id=?', chapterId);
  if (!chapter) return null;

  const land = safely(() => landSeatBrief(chapterId)) ?? {};
  const regions = safely(() => myRegions(chapterId)) ?? {};
  const l4 = regions.level4?.[0] ?? null;
  const region = l4 ? safely(() => regionBrief(l4.code)) : null;

  return {
    chapter: {
      name: chapter.name,
      scale: chapter.scale,
      represents: chapter.represents || null,
      does_not_represent: chapter.does_not_represent || null,
      locality: [chapter.locality, chapter.region, chapter.country].filter(Boolean).join(', ') || null,
    },
    place: land.place?.name ?? null,
    ecoregion: l4 ? { code: l4.code, name: l4.name, level3: l4.level3_name, biome: l4.biome } : null,
    watershed: land.watershed ?? null,
    // Only if the dossier is actually on disk. A region nobody downloaded must
    // read as absent rather than as empty — "no species recorded here" and
    // "nobody has fetched this region" are opposite claims.
    life: region?.downloaded ? region.life ?? null : null,
    soil: region?.downloaded ? oneLine(region.soil) : null,
    climate: region?.downloaded ? oneLine(region.climate) : null,
    // The local economy, as the dossier already summarised it from OpenStreetMap.
    within_reach: region?.downloaded ? oneLine(region.resources) : null,
    now: {
      water: land.water?.reading ?? null,
      water_stale: land.water?.stale ?? null,
      // Deduped by title: the same advisory is re-ingested on every hazard
      // beat, so an unfiltered list prints "Heat Advisory" three times and
      // spends the prompt saying one thing repeatedly.
      hazards: [...new Map((land.hazards ?? [])
        .map((h) => [h.title, `${h.severity}: ${h.title}`])).values()].slice(0, 3),
      season: land.season?.next_turn ?? null,
      daylight: land.season?.change_per_day ?? null,
    },
    open_work: {
      unaddressed_critical: land.unaddressed_critical ?? [],
      needs_waiting: one(
        `SELECT COUNT(*) n FROM intake WHERE chapter_id=? AND status='received'`, chapterId)?.n ?? 0,
      projects_open: one(
        `SELECT COUNT(*) n FROM quests WHERE chapter_id=? AND status IN ('Open','Active')`,
        chapterId)?.n ?? 0,
    },
    neighbours_known: one(
      `SELECT COUNT(*) n FROM federation_peers WHERE status IN ('known','connected','sharing')`)?.n ?? 0,
    region_downloaded: !!region?.downloaded,
  };
}

/**
 * The context as prose for a system prompt.
 *
 * Written as sentences rather than JSON because it is read by a model deciding
 * what to reach for, not parsed. Every line names where it came from, so the
 * assistant can tell the difference between "this was in my instructions" and
 * "I read this from a tool" — and so can anyone reading a transcript.
 */
export function placeBriefing(chapterId) {
  const c = placeContext(chapterId);
  if (!c) return '';
  const L = [];

  L.push(`WHERE YOU ARE (read from this machine's own records just now, not from memory)`);
  L.push(`${c.chapter.name} — a ${c.chapter.scale} chapter${c.chapter.locality ? ` in ${c.chapter.locality}` : ''}.`);
  if (c.chapter.represents) L.push(`It represents: ${c.chapter.represents}`);
  // Carried deliberately. A chapter's limits are the thing an assistant is most
  // likely to overstep by being helpful.
  if (c.chapter.does_not_represent) L.push(`It does NOT represent: ${c.chapter.does_not_represent}`);
  if (c.place) L.push(`Anchor place: ${c.place}.`);
  if (c.ecoregion) {
    L.push(`Ecoregion ${c.ecoregion.code.toUpperCase()}, ${c.ecoregion.name} ` +
           `(${c.ecoregion.level3}, ${c.ecoregion.biome} biome).`);
  }
  if (c.watershed) L.push(`Watershed: ${c.watershed}.`);

  if (c.life) {
    const sig = [c.life.signature_plants, c.life.signature_birds, c.life.signature_mammals]
      .flat().filter(Boolean).slice(0, 6);
    L.push(`Recorded here: ${c.life.plants_recorded ?? '?'} plants, ${c.life.animals_recorded ?? '?'} animals, ` +
           `${c.life.insects_recorded ?? '?'} insects; ${c.life.threatened_count ?? 0} threatened. ` +
           (sig.length ? `Commonly seen: ${sig.join(', ')}.` : ''));
  }
  if (c.soil) L.push(`Soil: ${c.soil}`);
  if (c.climate) L.push(`Climate: ${c.climate}`);
  if (c.within_reach) L.push(`Local economy and care within reach: ${c.within_reach}`);
  if (!c.region_downloaded) {
    L.push(`This ecoregion's dossier is NOT downloaded, so you know its name and nothing else ` +
           `about what lives here. Say so rather than generalising, and offer download_region.`);
  }

  L.push('');
  L.push('RIGHT NOW');
  if (c.now.water) L.push(`Water: ${c.now.water}${c.now.water_stale ? ' (stale — treat as history)' : ''}.`);
  for (const h of c.now.hazards) L.push(`Alert: ${h}`);
  if (c.now.season) L.push(`Season: ${c.now.season}${c.now.daylight ? `, ${c.now.daylight}` : ''}.`);
  if (c.open_work.unaddressed_critical.length) {
    L.push(`Critical and unaddressed: ${c.open_work.unaddressed_critical.join('; ')}.`);
  }
  L.push(`${c.open_work.projects_open} open project(s), ${c.open_work.needs_waiting} need(s) waiting for an answer, ` +
         `${c.neighbours_known} neighbour(s) known in the network.`);

  return L.join('\n');
}

/** A section of a dossier as one readable line, or null. */
function oneLine(section) {
  if (!section) return null;
  if (typeof section === 'string') return section;
  const s = section.readable ?? section.sentence ?? section.summary;
  if (s) return String(s).replace(/\s+/g, ' ').trim();
  return null;
}

function safely(fn) {
  try { const r = fn(); return r?.error ? null : r; } catch { return null; }
}
