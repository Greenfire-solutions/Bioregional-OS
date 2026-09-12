// ── Everything that can be put on the map ─────────────────────────────────
// The map drew three things: places, hubs and signals. Everything else a
// commons does — the projects, the needs somebody brought, the gatherings —
// existed only in lists, which meant the one view that is actually about a
// PLACE could not show what was happening in it.
//
// This returns every row that can honestly be drawn, each tagged with its kind,
// a badge that says something useful before anybody clicks, and where its
// coordinate came from.
//
// THAT LAST PART IS THE WHOLE CARE OF THIS FILE. A quest and an observation
// carry their own coordinates: somebody stood there. A need and a gathering do
// not — the schema has no lat/lng for either — so they can only be drawn at the
// centroid of the place they are attached to, or the chapter's own point. Those
// are different claims. Drawing them identically says "this need is HERE" when
// what is true is "this need belongs to a group whose centre is here", and a
// map that overstates its own precision is worse than one that omits things,
// because nobody can see it doing it.
//
// So every feature says `precise: true|false`, and the interface draws the two
// differently — the same rule core/provenance.mjs already applies to signals,
// extended to everything else that reaches the map.
import { all, one } from '../core/db.mjs';
import { humanObservedSql } from '../core/provenance.mjs';
import { openGatesSql } from './quest.mjs';

/**
 * The kinds, declared once.
 *
 * app/src/mapKinds.js holds the colour and shape for each of these keys, and a
 * test asserts the two lists are the same set — so a kind cannot be drawn and
 * missing from the key, or in the key and never drawn, which is the drift this
 * project keeps finding everywhere else.
 */
export const MAP_KINDS = Object.freeze([
  { key: 'place', label: 'Places' },
  { key: 'hub', label: 'Hubs' },
  { key: 'project', label: 'Projects' },
  { key: 'need', label: 'Needs brought' },
  { key: 'gathering', label: 'Gatherings' },
  { key: 'observation', label: 'What people noticed' },
  { key: 'reading', label: 'Instrument readings' },
]);

/**
 * The one thing worth doing to a feature, decided here.
 *
 * It used to be decided in the panel component, which made a second home for
 * "what to do about a blocked project" — engines/board.mjs already returns
 * `action: { tool, input }` on every item it emits, and the interface supplies
 * only the wording. Two homes is how a rule gets fixed in one of them.
 *
 * Matched to what is actually wrong with the thing rather than offered
 * generically: a blocked project offers the gate, a waiting need offers the
 * answer. A map whose every pin said "see more" would be a table of contents.
 */
function actionFor(f) {
  switch (f.kind) {
    case 'project':
      return f.state === 'blocked'
        ? { tool: 'satisfy_quest_gate', input: { quest_id: f.id },
            note: 'Or pass it with a reason, if it genuinely does not apply.' }
        : { tool: 'update_quest', input: { quest_id: f.id } };
    case 'need':
      return { tool: 'respond_to_intake', input: { intake_id: f.id },
               note: 'A person may submit a need, receive a response, and appeal.' };
    case 'gathering':
      // update_gathering, never add_gathering. The latter INSERTS, so "add care
      // to this gathering" used to create a second gathering with the same
      // title and leave the unprovisioned one exactly as it was.
      return f.care != null && f.care < 2
        ? { tool: 'update_gathering', input: { gathering_id: f.id },
            note: 'Meals, transport, childcare, accessibility — at least two of four.' }
        : { goTo: 'gatherings' };
    case 'observation':
      return { tool: 'open_quest', input: { signal_id: f.id, title: f.title },
               note: 'Observation must lead somewhere, or it is surveillance.' };
    case 'place': return { goTo: 'place' };
    case 'hub': return { goTo: 'place' };
    case 'reading': return { goTo: 'signals' };
    default: return null;
  }
}

export function mapFeatures(chapterId, { kinds = null } = {}) {
  if (!chapterId) return { error: 'no_chapter', features: [], kinds: MAP_KINDS };
  const want = kinds ? new Set(kinds) : null;
  const on = (k) => !want || want.has(k);
  const out = [];

  const places = all(
    'SELECT id, name, lat, lng, watershed_name, ecoregion_name, description FROM places WHERE chapter_id=?',
    chapterId);
  const placeAt = new Map(places.map((p) => [p.id, p]));
  const chapter = one('SELECT name, lat, lng FROM chapters WHERE id=?', chapterId);

  /** Where this row can honestly be drawn, and whether the point is its own. */
  // BOTH halves, everywhere. lat and lng are independent nullable columns and
  // add_place takes them as independent optional numbers, so a row with a
  // latitude and no longitude is a thing that exists. Testing only lat let one
  // through as `precise: true` with `lng: null`, which deck.gl draws at
  // [null, 12] and the panel renders by calling .toFixed on null.
  const has = (o) => o && o.lat != null && o.lng != null;
  const locate = (row) => {
    if (has(row)) return { lat: row.lat, lng: row.lng, precise: true, borrowed_from: null };
    const p = row.place_id ? placeAt.get(row.place_id) : null;
    if (has(p)) return { lat: p.lat, lng: p.lng, precise: false, borrowed_from: p.name };
    if (has(chapter)) return { lat: chapter.lat, lng: chapter.lng, precise: false, borrowed_from: chapter.name };
    return null;
  };

  if (on('place')) {
    for (const p of places) {
      if (!has(p)) continue;
      out.push({
        kind: 'place', id: p.id, title: p.name, lat: p.lat, lng: p.lng,
        precise: true, borrowed_from: null,
        badge: null,
        sub: [p.watershed_name, p.ecoregion_name].filter(Boolean).join(' · ') || null,
      });
    }
  }

  if (on('hub')) {
    for (const h of all('SELECT id, name, type, lat, lng, description FROM hubs WHERE chapter_id=?', chapterId)) {
      if (!has(h)) continue;
      out.push({
        kind: 'hub', id: h.id, title: h.name, lat: h.lat, lng: h.lng,
        precise: true, borrowed_from: null, badge: null, sub: h.type ?? null,
      });
    }
  }

  if (on('project')) {
    for (const q of all(
      `SELECT id, title, stage, status, place_id, lat, lng, maintenance_owner, description
         FROM quests WHERE chapter_id=? AND status NOT IN ('Complete','Stopped')`, chapterId)) {
      const at = locate(q);
      if (!at) continue;
      // The shared predicate, not a fourth hand-rolled copy. Three other
      // places spell this out and two of them forget `overridden_at`, so an
      // overridden gate makes one part of the app call a project clear while
      // another still calls it blocked.
      const open = all(openGatesSql(), q.id).length;
      out.push({
        kind: 'project', id: q.id, title: q.title, ...at,
        // The badge is the number of things in the way, because that is what a
        // person wants to know about a project without opening it. Zero is not
        // drawn as "0" — an empty badge reads as nothing to do, which is right.
        badge: open || null,
        state: open ? 'blocked' : 'running',
        sub: `${String(q.stage).replace(/_/g, ' ')}${q.maintenance_owner ? ` · ${q.maintenance_owner}` : ''}`,
      });
    }
  }

  if (on('need')) {
    // Private needs never reach the map. A pin is a disclosure with a location
    // on it, which is the most public form a private thing can take.
    for (const r of all(
      `SELECT id, body, submitted_by, status, created_at FROM intake
        WHERE chapter_id=? AND private=0 AND status='received'`, chapterId)) {
      const at = locate({ ...r, place_id: null });
      if (!at) continue;
      out.push({
        kind: 'need', id: r.id, title: truncate(r.body, 70), ...at,
        // Zero is an answer here — "brought today" — unlike a project's zero,
        // which means nothing is in its way and is better left blank.
        badge: daysSince(r.created_at),
        sub: `${r.submitted_by || 'Someone'} · waiting`,
      });
    }
  }

  if (on('gathering')) {
    for (const g of all(
      `SELECT id, title, kind, starts_at, place_id, location_name, rsvp_count,
              care_meals + care_transport + care_childcare + care_accessibility care
         FROM gatherings WHERE chapter_id=?`, chapterId)) {
      const at = locate(g);
      if (!at) continue;
      out.push({
        kind: 'gathering', id: g.id, title: g.title, ...at,
        badge: g.rsvp_count || null,
        sub: [g.starts_at ? String(g.starts_at).slice(0, 10) : null, g.location_name].filter(Boolean).join(' · ') || null,
        care: g.care,
      });
    }
  }

  // The split that matters, and the one the old single "Signals" toggle hid:
  // what a PERSON noticed and what an INSTRUMENT reported are different claims
  // about a place, and a commons mostly wants to see the first without the
  // second burying it. Seventy gage readings and three observations on one map
  // is a map of the gage.
  if (on('observation')) {
    for (const s of all(
      `SELECT id, title, severity, author, category, lat, lng, place_id,
              coalesce(observed_at, created_at) at
         FROM signals WHERE chapter_id=? AND ${humanObservedSql('source_adapter')}`, chapterId)) {
      const at = locate(s);
      if (!at) continue;
      out.push({
        kind: 'observation', id: s.id, title: s.title, ...at,
        badge: null, severity: s.severity,
        sub: [s.author, s.category, String(s.at ?? '').slice(0, 10)].filter(Boolean).join(' · '),
      });
    }
  }

  if (on('reading')) {
    for (const s of all(
      `SELECT id, title, severity, source_adapter, quantity_value, quantity_unit, lat, lng, place_id,
              coalesce(observed_at, created_at) at
         FROM signals WHERE chapter_id=? AND NOT ${humanObservedSql('source_adapter')}
         ORDER BY at DESC LIMIT 400`, chapterId)) {
      const at = locate(s);
      if (!at) continue;
      out.push({
        kind: 'reading', id: s.id, title: s.title, ...at,
        badge: null, severity: s.severity,
        sub: [s.quantity_value != null ? `${s.quantity_value}${s.quantity_unit ? ` ${s.quantity_unit}` : ''}` : null,
              s.source_adapter, String(s.at ?? '').slice(0, 10)].filter(Boolean).join(' · '),
      });
    }
  }

  for (const f of out) f.action = actionFor(f);

  const counts = {};
  for (const f of out) counts[f.kind] = (counts[f.kind] ?? 0) + 1;

  return {
    features: out,
    kinds: MAP_KINDS,
    counts,
    borrowed: out.filter((f) => !f.precise).length,
    note: 'A need and a gathering have no coordinates of their own — the schema has none — so ' +
          'they are drawn at the centre of the place they belong to and marked as borrowed. ' +
          '"This is here" and "this belongs to a group whose centre is here" are different claims.',
  };
}

function truncate(s, n) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
function daysSince(ts) {
  if (!ts) return 0;
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
