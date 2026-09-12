// ── Engine: Bioregional ───────────────────────────────────────────────────
// Mandate: observe land, water, climate, species, food, energy, materials.
// Output: seasonal dashboard and priority map.
import { all, one, create, run } from '../core/db.mjs';
import { resolveEcoregion } from '../adapters/ecoregion.mjs';
import { resolveWatershed, waterSignals } from '../adapters/watershed.mjs';
import { groundProfile } from '../adapters/soil.mjs';
import { lifeHere as lifeUpstream } from '../adapters/life.mjs';
import { hazardsHere as hazardsUpstream, hazardSignals } from '../adapters/hazards.mjs';
import { registerLayer, registerDiscovered, source as registrySource } from '../adapters/registry.mjs';
import { discover as discoverUpstream, classifyLicense } from '../adapters/discover.mjs';
import { humanObservedSql, automatedSql, humanObserved as humanSource } from '../core/provenance.mjs';

/**
 * Stage 1 — Locate. Resolve a place against open reference data.
 *
 * Atlas layers 1, 2, 4 and the standing half of 6, in one pass — and this pass
 * runs ONCE per place and then never again. Ecoregion boundaries, watershed
 * lines, soil series, elevation and the regulatory floodplain do not change on
 * any schedule a heartbeat could usefully track. Everything that DOES change
 * (water, weather, hazard events, what has been observed) has its own path.
 *
 * Every upstream is optional and independent. A place still locates if the soil
 * service is down; it just knows less, and says which part it is missing.
 */
export async function locate(placeId, { refresh = false } = {}) {
  const p = one('SELECT * FROM places WHERE id = ?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null || p.lng == null) return { error: 'no_coordinates' };

  const [eco, wshed, profile, flood] = await Promise.all([
    resolveEcoregion(p.lat, p.lng).catch(() => null),
    resolveWatershed(p.lat, p.lng).catch(() => null),
    // Skip the land pass when it is already answered, unless asked to redo it.
    (!refresh && p.soil_source) ? Promise.resolve(null) : groundProfile(p.lat, p.lng).catch(() => null),
    (!refresh && p.flood_zone != null) ? Promise.resolve(null) : floodOnly(p.lat, p.lng),
  ]);

  const soil = profile?.soil?.available ? profile.soil : null;
  const elev = profile?.elevation?.available ? profile.elevation : null;
  const cover = profile?.land_cover?.available ? profile.land_cover : null;

  run(
    `UPDATE places SET ecoregion_name=COALESCE(?,ecoregion_name),
       bioregion_name=COALESCE(?,bioregion_name), biome=COALESCE(?,biome),
       realm=COALESCE(?,realm), watershed_huc=COALESCE(?,watershed_huc),
       watershed_name=COALESCE(?,watershed_name),
       soil_series=COALESCE(?,soil_series), soil_map_unit=COALESCE(?,soil_map_unit),
       soil_order=COALESCE(?,soil_order), soil_drainage=COALESCE(?,soil_drainage),
       soil_hydric=COALESCE(?,soil_hydric), soil_ph=COALESCE(?,soil_ph),
       soil_organic_matter=COALESCE(?,soil_organic_matter), soil_clay_pct=COALESCE(?,soil_clay_pct),
       soil_awc=COALESCE(?,soil_awc), soil_source=COALESCE(?,soil_source),
       elevation_m=COALESCE(?,elevation_m),
       land_cover=COALESCE(?,land_cover), land_cover_code=COALESCE(?,land_cover_code),
       flood_zone=COALESCE(?,flood_zone), in_floodplain=COALESCE(?,in_floodplain)
     WHERE id=?`,
    eco?.ecoregion_name ?? null, eco?.bioregion_name ?? null, eco?.biome ?? null,
    eco?.level2_name ?? null, wshed?.watershed_huc ?? null, wshed?.watershed_name ?? null,
    soil?.series ?? null, soil?.map_unit ?? null, soil?.taxonomic_order ?? null,
    soil?.drainage ?? null, soil?.hydric == null ? null : (soil.hydric ? 1 : 0),
    soil?.rooting_zone?.ph ?? null, soil?.rooting_zone?.organic_matter_pct ?? null,
    soil?.rooting_zone?.clay_pct ?? null, soil?.rooting_zone?.available_water_capacity ?? null,
    soil?.source_id ?? null,
    elev?.metres ?? null, cover?.class ?? null, cover?.code ?? null,
    flood?.zone ?? null, flood == null ? null : (flood.in_special_flood_hazard_area ? 1 : 0),
    placeId
  );

  // An Atlas layer is registered only by the source that actually answered, so
  // list_atlas_layers reports what this chapter can see rather than what it hoped for.
  if (eco) registerLayer(p.chapter_id, 'epa-ecoregions');
  if (wshed) registerLayer(p.chapter_id, 'usgs-wbd');
  if (soil) registerLayer(p.chapter_id, soil.source_id);
  if (elev?.source_id === 'usgs-3dep') registerLayer(p.chapter_id, 'usgs-3dep');
  if (cover) registerLayer(p.chapter_id, 'mrlc-nlcd');
  if (flood?.available) registerLayer(p.chapter_id, 'fema-nfhl');

  return {
    place: one('SELECT * FROM places WHERE id = ?', placeId),
    ecoregion: eco, watershed: wshed,
    soil: profile?.soil ?? null, elevation: profile?.elevation ?? null,
    land_cover: profile?.land_cover ?? null, flood: flood ?? null,
    // Naming what did not answer is the difference between "nothing here" and
    // "we could not ask" — the operator needs to tell those apart.
    missing: [
      !eco && 'ecoregion', !wshed && 'watershed',
      profile && !soil && 'soil', profile && !elev && 'elevation',
      profile && !cover && 'land cover',
    ].filter(Boolean),
  };
}

async function floodOnly(lat, lng) {
  const { floodZone } = await import('../adapters/hazards.mjs');
  return floodZone(lat, lng).catch(() => null);
}

/**
 * Atlas layer 5 — what lives here.
 *
 * Read-through, not ingested: species lists are upstream facts about the
 * bioregion, not observations this chapter made, and filing them as signals
 * would drown the chapter's own record in a million GBIF rows and quietly
 * change what "we observed this" means.
 */
export async function lifeHere(placeId, { radiusKm = 10, limit = 20 } = {}) {
  const p = one('SELECT * FROM places WHERE id = ?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };
  const life = await lifeUpstream(p.lat, p.lng, { radiusKm, limit });
  if (life.species?.available || life.record_depth?.available) {
    registerLayer(p.chapter_id, life.species?.available ? 'inaturalist' : 'gbif');
  }
  return { place: { id: p.id, name: p.name }, ...life };
}

/**
 * Atlas layer 6 — hazards, and the one upstream allowed to raise a Watch or a
 * Critical without a human. Events become signals; standing conditions do not.
 *
 * Deduped on the alert's own stable id, so re-reading the feed every hour
 * updates one row rather than stacking a new one each time.
 */
export async function hazards(placeId, { ingest = true } = {}) {
  const p = one('SELECT * FROM places WHERE id = ?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };

  const h = await hazardsUpstream(p.lat, p.lng);
  let added = 0, updated = 0;
  if (ingest) {
    for (const s of hazardSignals(h, { lat: p.lat, lng: p.lng, locationName: p.name })) {
      const existing = one(
        `SELECT id FROM signals WHERE chapter_id=? AND source_adapter=? AND source_ref=?`,
        p.chapter_id, s.source_adapter, s.source_ref);
      if (existing) {
        run(`UPDATE signals SET severity=?, description=?, observed_at=? WHERE id=?`,
            s.severity, s.description, s.observed_at, existing.id);
        updated++;
      } else {
        create('signals', 'signal', p.chapter_id, { ...s, chapter_id: p.chapter_id, place_id: p.id });
        added++;
      }
    }
  }
  // The standing condition belongs on the place, refreshed as it is seen.
  if (h.flood?.available) {
    run(`UPDATE places SET flood_zone=?, in_floodplain=? WHERE id=?`,
        h.flood.zone, h.flood.in_special_flood_hazard_area ? 1 : 0, p.id);
    registerLayer(p.chapter_id, 'fema-nfhl');
  }
  if (h.alerts?.available) registerLayer(p.chapter_id, 'nws');
  if (h.drought?.available) registerLayer(p.chapter_id, 'usdm');

  return { place: { id: p.id, name: p.name }, ...h, signals: { added, updated } };
}

/** Stage 3 — Observe. Pull live public-domain gage data in as signals. */
export async function ingestWater(placeId) {
  const p = one('SELECT * FROM places WHERE id = ?', placeId);
  if (!p?.lat) return { error: 'no_coordinates' };
  const incoming = await waterSignals(p.lat, p.lng);
  let added = 0, updated = 0;
  for (const s of incoming) {
    const existing = one(
      `SELECT id FROM signals WHERE chapter_id=? AND source_adapter='usgs' AND source_ref=? AND title=?`,
      p.chapter_id, s.source_ref, s.title
    );
    if (existing) {
      run(`UPDATE signals SET quantity_value=?, observed_at=? WHERE id=?`,
          s.quantity_value, s.observed_at, existing.id);
      updated++;
    } else {
      create('signals', 'signal', p.chapter_id, { ...s, chapter_id: p.chapter_id, place_id: p.id });
      added++;
    }
  }
  if (incoming.length) registerLayer(p.chapter_id, 'usgs-nwis');
  return { added, updated, total: incoming.length };
}

/**
 * The seasonal dashboard. Not a vanity metric — it is the Land Seat's
 * briefing material, so it leads with what is unresolved.
 */
export function dashboard(chapterId) {
  const places = all('SELECT * FROM places WHERE chapter_id=?', chapterId);
  const critical = all(
    `SELECT * FROM signals WHERE chapter_id=? AND severity='Critical' ORDER BY created_at DESC`, chapterId);
  const watch = all(
    `SELECT * FROM signals WHERE chapter_id=? AND severity='Watch' ORDER BY created_at DESC`, chapterId);
  // "Unverified" used to mean one thing, because only people wrote signals.
  // Now an automated upstream can too, and the two need different responses:
  // an unverified human observation wants corroborating, an unconfirmed
  // satellite detection wants someone to go and look. Counting them together
  // produces a number that means neither — so they are counted apart, through
  // the one shared rule in core/provenance.mjs rather than a predicate invented
  // here that could drift away from it.
  const unverified = one(
    `SELECT COUNT(*) n FROM signals WHERE chapter_id=? AND verified=0
       AND ${humanObservedSql()}`, chapterId)?.n ?? 0;
  const unconfirmedAutomated = one(
    `SELECT COUNT(*) n FROM signals WHERE chapter_id=? AND verified=0
       AND ${automatedSql()}`, chapterId)?.n ?? 0;
  const unlocated = places.filter((p) => !p.watershed_huc || !p.ecoregion_name);
  const questsByStage = all(
    `SELECT stage, COUNT(*) n FROM quests WHERE chapter_id=? AND status IN ('Open','Active')
     GROUP BY stage`, chapterId);
  const overdueIndicators = all(
    `SELECT i.* FROM indicators i
      WHERE i.chapter_id=? AND i.target_by IS NOT NULL AND date(i.target_by) < date('now')
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.indicator_id=i.id
                        AND date(m.measured_at) >= date(i.target_by))`, chapterId);

  return {
    places: places.length,
    unlocated: unlocated.map((p) => ({ id: p.id, name: p.name })),
    critical, watch,
    // The Land Seat is briefed on hazards whoever reported them, so neither list
    // is filtered — but it should be able to see at a glance how much of this is
    // the land reporting itself and how much is people noticing.
    reported_by: {
      people: critical.concat(watch).filter((s) => humanSource(s.source_adapter)).length,
      upstreams: critical.concat(watch).filter((s) => !humanSource(s.source_adapter)).length,
    },
    unverified_signals: unverified,
    unconfirmed_automated: unconfirmedAutomated,
    quests_by_stage: Object.fromEntries(questsByStage.map((r) => [r.stage, r.n])),
    indicators_overdue: overdueIndicators,
    water_last_seen: one(
      `SELECT MAX(observed_at) t FROM signals WHERE chapter_id=? AND source_adapter='usgs'`, chapterId)?.t ?? null,
  };
}


// ── Stage 4: Map — what this locality already publishes ───────────────────

/**
 * Discover datasets a chapter's own city or county publishes, and file them as
 * CANDIDATES.
 *
 * The protocol rule this implements is the one the upstream registry exists for:
 * no unreviewed licence reaches an export. So the gate is narrow and it is the
 * licence, not the usefulness — an unambiguous public-domain dedication approves
 * itself, and every other licence, including every open-with-conditions one,
 * waits for a named person. Attribution and share-alike are obligations somebody
 * has to accept ON BEHALF OF the commons, and a machine cannot accept an
 * obligation.
 */
export async function discoverData(chapterId, { subject, locality = null, region = null, limit = 12 } = {}) {
  const chapter = one('SELECT * FROM chapters WHERE id=?', chapterId);
  if (!chapter) return { error: 'no_chapter' };

  const found = await discoverUpstream({
    locality: locality ?? chapter.locality,
    region: region ?? chapter.region,
    subject, limit,
  });
  if (found.error) return found;

  let approved = 0, held = 0, already = 0, unaddressable = 0;
  const filed = [];
  for (const c of found.candidates) {
    // No stable URL means nothing to dedupe on, link to, or come back for — but
    // it gets COUNTED, because a candidate that vanishes between the total and
    // the breakdown is the kind of gap that reads as a rounding error.
    if (!c.source_url) { unaddressable++; continue; }
    const exists = one(
      'SELECT id, status FROM discovered_datasets WHERE chapter_id=? AND source_url=?',
      chapterId, c.source_url);
    if (exists) { already++; continue; }

    const auto = c.license.auto_approvable;
    const row = create('discovered_datasets', 'discovered_dataset', chapterId, {
      chapter_id: chapterId,
      title: c.title ?? '(untitled dataset)',
      description: c.description, publisher: c.publisher,
      portal: c.portal, portal_type: c.portal_type, subject,
      source_url: c.source_url, api_url: c.api_url,
      atlas_layer: c.atlas_layer,
      license_raw: c.license.raw, license_class: c.license.class,
      license_note: c.license.why,
      status: auto ? 'approved' : 'candidate',
      // Auto-approval is still a review, and it says so rather than leaving the
      // reviewer blank — a blank reviewer reads as "nobody checked", and here
      // something did check, by a rule anyone can go and read.
      reviewed_by: auto ? `automatic (${c.license.matched})` : null,
      reviewed_at: auto ? new Date().toISOString() : null,
      review_note: auto ? c.license.why : null,
    }, auto ? 'public' : 'members');

    // Public domain approves the DATASET. It only reaches the map if the dataset
    // itself says what it is about — licence and relevance are separate gates.
    if (auto && c.atlas_layer) registerDiscovered(chapterId, { ...row, layer_match: c.layer_match }, { sensitivity: 'public' });
    if (auto) approved++; else held++;
    filed.push({ id: row.id, title: row.title, status: row.status, license: c.license });
  }

  return {
    ...found,
    filed, 
    counts: { ...found.counts, approved, held, already_known: already, no_stable_url: unaddressable },
    readable: approved || held
      ? `${found.readable} ${approved ? `${approved} added to the Atlas automatically.` : ''}`.trim() +
        (held ? ` ${held} waiting for someone to read the terms.` : '')
      : found.readable,
  };
}

/** Candidates, and what was decided about the rest. */
export function listDiscovered(chapterId, { status = null, subject = null } = {}) {
  const rows = all(
    `SELECT * FROM discovered_datasets WHERE chapter_id=?
       ${status ? 'AND status=?' : ''} ${subject ? 'AND subject=?' : ''}
     ORDER BY (status='candidate') DESC, discovered_at DESC`,
    ...[chapterId, status, subject].filter((v) => v != null));
  const waiting = rows.filter((r) => r.status === 'candidate');
  return {
    datasets: rows,
    counts: {
      candidates: waiting.length,
      approved: rows.filter((r) => r.status === 'approved').length,
      declined: rows.filter((r) => r.status === 'declined').length,
    },
    readable: waiting.length
      ? `${waiting.length} discovered dataset${waiting.length === 1 ? '' : 's'} waiting on somebody to read the licence.`
      : rows.length ? 'Nothing discovered is waiting on a decision.' : 'Nothing discovered yet.',
  };
}

/**
 * Approve a discovered dataset by hand.
 * Refuses without a named reviewer, for the same reason quest gates do: a
 * decision nobody's name is on cannot be questioned later, and accepting
 * somebody else's licence terms on behalf of a commons is exactly the kind of
 * decision that should be answerable.
 */
export function approveDataset(id, { reviewed_by = null, note = null, sensitivity = 'members' } = {}) {
  const d = one('SELECT * FROM discovered_datasets WHERE id=?', id);
  if (!d) return { error: 'not_found' };
  if (!reviewed_by || !String(reviewed_by).trim()) {
    return {
      error: 'reviewer_required',
      message: 'Name who is approving this. Accepting a licence on the commons\' behalf is a ' +
               'decision somebody has to be answerable for.',
      licence: d.license_raw ?? '(the portal stated none)',
      why_held: d.license_note,
    };
  }
  if (d.status === 'approved') return { error: 'already_approved', dataset: d };

  run(`UPDATE discovered_datasets SET status='approved', reviewed_by=?, reviewed_at=datetime('now'),
         review_note=? WHERE id=?`, String(reviewed_by).trim(), note, id);
  const updated = one('SELECT * FROM discovered_datasets WHERE id=?', id);
  const layer = updated.atlas_layer
    ? registerDiscovered(d.chapter_id, updated, { sensitivity })
    : null;
  return {
    dataset: updated, atlas_layer: layer,
    note: updated.atlas_layer ? null
      : 'Approved, but filed against no Atlas layer — set atlas_layer to put it on the map.',
  };
}

/** Decline one, with the reason kept: a refusal nobody can read gets re-litigated. */
export function declineDataset(id, { reviewed_by = null, reason = null } = {}) {
  const d = one('SELECT * FROM discovered_datasets WHERE id=?', id);
  if (!d) return { error: 'not_found' };
  if (!reason || !String(reason).trim()) {
    return { error: 'reason_required', message: 'Say why. A refusal with no reason gets asked again next season.' };
  }
  run(`UPDATE discovered_datasets SET status='declined', reviewed_by=?, reviewed_at=datetime('now'),
         review_note=? WHERE id=?`, reviewed_by ?? null, String(reason).trim(), id);
  return { dataset: one('SELECT * FROM discovered_datasets WHERE id=?', id) };
}

// ── Stage 11: Measure — a baseline from public record ─────────────────────

/**
 * Offer a defensible baseline for an indicator, from open data.
 *
 * The protocol rule is "monitoring must change decisions". In practice it does
 * not, and the reason is upstream of any interface: a chapter has to type its
 * own baseline, so the baseline is a guess or is missing, and a
 * `decision_trigger` set against a guess cannot honestly fire. The rule exists
 * on paper only.
 *
 * Public record fixes that — creek discharge against its own thirty-year
 * median, soil organic matter from the survey, canopy from land cover, leaf-out
 * against the normal. Each answer carries its source, its licence and its
 * method, so the number is arguable rather than asserted, and a trigger set
 * against it can fire and be defended.
 *
 * It refuses rather than guesses. A wrong baseline is worse than none: it makes
 * a decision look evidenced when it is not.
 */
export async function proposeBaseline(chapterId, { indicator, place_id = null } = {}) {
  if (!indicator) return { error: 'no_indicator', message: 'Name what is being measured.' };

  const want = String(indicator).toLowerCase();
  const match = (...words) => words.some((w) => want.includes(w));

  // Whether anything open measures this is a fact about the indicator, not about
  // where you are standing — so it is answered first. Asking for a place and
  // THEN saying "nothing measures that anyway" wastes the person's time and
  // hides the real answer behind a different problem.
  const MEASURABLE = [
    ['flow', 'discharge', 'cfs', 'streamflow', 'creek level', 'gage'],
    ['organic matter', 'soil carbon', 'soil organic'], ['soil ph', 'ph'],
    ['canopy', 'tree cover', 'forest cover', 'land cover', 'impervious'],
    ['species', 'biodiversity', 'richness'],
    ['leaf', 'bloom', 'spring', 'phenolog', 'first flower'],
    ['temperature', 'rainfall', 'precipitation', 'climate'],
  ];
  if (!MEASURABLE.some((group) => group.some((w) => want.includes(w)))) {
    return unmeasurable(indicator, 'no open source in this OS measures that');
  }

  const place = place_id
    ? one('SELECT * FROM places WHERE id=?', place_id)
    : one(`SELECT * FROM places WHERE chapter_id=? AND lat IS NOT NULL
             ORDER BY (watershed_huc IS NULL), (ecoregion_name IS NULL) LIMIT 1`, chapterId);
  if (!place?.lat) {
    return { error: 'no_location', message: 'A baseline needs somewhere to be a baseline of. Add a place with coordinates.' };
  }

  // ── water ──
  if (match('flow', 'discharge', 'cfs', 'streamflow', 'creek level', 'gage')) {
    const { gageContext } = await import('../adapters/watershed.mjs');
    const site = one(
      `SELECT source_ref FROM signals WHERE chapter_id=? AND source_adapter='usgs' AND source_ref IS NOT NULL LIMIT 1`,
      chapterId)?.source_ref;
    if (!site) return unmeasurable(indicator, 'no USGS gage has been ingested for this chapter yet — run ingest_water_data first');
    const g = await gageContext(site).catch(() => null);
    // Named exactly, with no fallback. An earlier version read `day_median`,
    // which does not exist, and `??` fell through to the SEVEN-DAY median — a
    // different statistic answering a different question. Both were 0 that day,
    // so it read as correct. A fallback between two statistics is not a safety
    // net, it is a way to be wrong quietly.
    const median = g?.day_of_year_median ?? null;
    if (median == null) {
      return unmeasurable(indicator,
        'the gage answered but carries no approved median for this calendar day — USGS statistics ' +
        'cover approved data only, so recent years can be missing');
    }
    return baseline({
      value: median, unit: g.unit ?? 'ft3/s',
      method: `USGS gage ${site}, median of all daily means for this calendar day across the period of record`,
      source: 'USGS NWIS daily statistics', source_id: 'usgs-nwis',
      note: [
        g.years_of_record ? `Drawn from ${g.years_of_record} years of record.` : null,
        median === 0 ? 'The median is zero: this reach is normally dry on this date. A target above zero is a change in kind, not degree.' : null,
      ].filter(Boolean).join(' ') || null,
    });
  }

  // ── soil ──
  if (match('organic matter', 'soil carbon', 'soil organic')) {
    return place.soil_organic_matter == null
      ? unmeasurable(indicator, 'this place has no soil survey result yet — run soil_at first')
      : baseline({ value: place.soil_organic_matter, unit: '%',
          method: 'Depth-weighted mean over the top 30 cm of the dominant soil component',
          source: place.soil_source === 'usda-ssurgo' ? 'USDA SSURGO' : 'ISRIC SoilGrids',
          source_id: place.soil_source ?? 'usda-ssurgo' });
  }
  if (match('soil ph', 'ph')) {
    return place.soil_ph == null
      ? unmeasurable(indicator, 'this place has no soil survey result yet — run soil_at first')
      : baseline({ value: place.soil_ph, unit: 'pH',
          method: 'Depth-weighted mean over the top 30 cm',
          source: place.soil_source === 'usda-ssurgo' ? 'USDA SSURGO' : 'ISRIC SoilGrids',
          source_id: place.soil_source ?? 'usda-ssurgo' });
  }

  // ── living cover ──
  if (match('canopy', 'tree cover', 'forest cover', 'land cover', 'impervious')) {
    return place.land_cover == null
      ? unmeasurable(indicator, 'this place has no land cover result yet — run soil_at first')
      : baseline({ value: place.land_cover_code, unit: 'NLCD class',
          method: `Land cover class at this point is "${place.land_cover}". A percentage baseline needs a boundary, not a point — draw one and measure it in QGIS from the same NLCD raster.`,
          source: 'USGS National Land Cover Database', source_id: 'mrlc-nlcd',
          note: 'Recorded as a class, not a percentage — say so rather than implying a precision this does not have.' });
  }
  if (match('species', 'biodiversity', 'richness')) {
    const { speciesHere } = await import('../adapters/life.mjs');
    const s = await speciesHere(place.lat, place.lng, { radiusKm: 5, limit: 1 }).catch(() => null);
    return s?.available
      ? baseline({ value: s.total_species, unit: 'species',
          method: 'Distinct research-grade species recorded within 5 km on iNaturalist',
          source: 'iNaturalist', source_id: 'inaturalist',
          note: 'Recording effort, not abundance — a rise may mean more observers rather than more life. Compare like season with like season.' })
      : unmeasurable(indicator, 'iNaturalist did not answer');
  }

  // ── the season ──
  if (match('leaf', 'bloom', 'spring', 'phenolog', 'first flower')) {
    const { springIndex } = await import('../adapters/phenology.mjs');
    const sp = await springIndex(place.lat, place.lng).catch(() => null);
    return sp?.available && sp.leaf_out_normal_doy != null
      ? baseline({ value: sp.leaf_out_normal_doy, unit: 'day of year',
          method: 'Thirty-year normal first-leaf date from the USA-NPN Extended Spring Index',
          source: 'USA National Phenology Network', source_id: 'usa-npn',
          note: `That is ${sp.leaf_out_normal_date}. This year is running ${sp.anomaly_days == null ? 'unknown' : Math.abs(sp.anomaly_days) + ' days ' + (sp.anomaly_days < 0 ? 'early' : 'late')}.` })
      : unmeasurable(indicator, 'outside USA-NPN model coverage');
  }

  // ── climate ──
  if (match('temperature', 'rainfall', 'precipitation', 'climate')) {
    const { climateNormals } = await import('../adapters/phenology.mjs');
    const n = await climateNormals(place.lat, place.lng).catch(() => null);
    if (!n?.available) return unmeasurable(indicator, 'NASA POWER did not answer');
    const rain = match('rain', 'precip');
    return baseline({
      value: rain ? null : n.annual_mean_c,
      unit: rain ? 'mm/day by month' : '°C',
      method: rain
        ? `Forty-year monthly normals; wettest ${n.wettest_month}, driest ${n.driest_month}`
        : 'Forty-year annual mean air temperature at 2 m',
      source: 'NASA POWER', source_id: 'nasa-power',
      note: rain ? 'Monthly, not annual — an annual rainfall figure hides the thing that matters here.' : null,
      detail: rain ? n.monthly : null,
    });
  }

  return unmeasurable(indicator, 'no open source in this OS measures that');
}

function baseline({ value, unit, method, source, source_id, note = null, detail = null }) {
  return {
    proposed: true,
    baseline_value: value, unit, method,
    source, source_id,
    // The licence travels with the number, because the number may end up in a
    // report that leaves the machine.
    licence: registrySourceLicence(source_id),
    measured_at: new Date().toISOString().slice(0, 10),
    note, detail,
    caveat: 'A baseline from public record, not a reading somebody took. Say so when it is quoted.',
  };
}

// Statically imported. An earlier version used require() here, which does not
// exist in an ES module — it threw, the catch swallowed it, and every baseline
// came back with a null licence. Nothing looked wrong: a missing licence renders
// as a missing licence.
const registrySourceLicence = (id) => registrySource(id)?.license ?? null;

const unmeasurable = (indicator, why) => ({
  proposed: false,
  error: 'no_baseline',
  message: `Nothing open measures "${indicator}" here — ${why}.`,
  // Refusing is the point. A wrong baseline makes a decision look evidenced.
  guidance: 'Measure it yourself and record the method. An indicator with a baseline somebody ' +
            'actually took is worth more than one with a number nobody can defend.',
});

// ── Stages 7-11: the people, the memory, the growing year ─────────────────

/** Atlas layers 7-10 — what is already here, and registers the layers it finds. */
export async function communityAt(placeId, { radiusKm = 3 } = {}) {
  const p = one('SELECT * FROM places WHERE id=?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };
  const { communityHere, layersCovered } = await import('../adapters/community.mjs');
  const r = await communityHere(p.lat, p.lng, { radiusKm });
  // One source fills four layers, so it registers once per layer it actually
  // found something in — an honest coverage report, not a blanket claim.
  if (r.available) {
    for (const n of layersCovered(r)) registerLayer(p.chapter_id, 'openstreetmap', { layer: n });
  }
  return { place: { id: p.id, name: p.name }, ...r };
}

/** Atlas layer 11 — culture, memory, and the sound of the place. */
export async function cultureAt(placeId, { radiusKm = 5 } = {}) {
  const p = one('SELECT * FROM places WHERE id=?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };
  const { cultureHere } = await import('../adapters/culture.mjs');
  const r = await cultureHere(p.lat, p.lng, { placeName: p.name, radiusKm });
  if (r.historic?.available || r.articles?.available) registerLayer(p.chapter_id, 'openstreetmap');
  if (r.papers?.available) registerLayer(p.chapter_id, 'chronicling-america');
  if (r.research?.available) registerLayer(p.chapter_id, 'openalex');
  return { place: { id: p.id, name: p.name }, ...r };
}

/** The growing year at a place. */
export async function growingYearAt(placeId, { zip = null } = {}) {
  const p = one('SELECT * FROM places WHERE id=?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };
  const { growingYear } = await import('../adapters/phenology.mjs');
  const r = await growingYear(p.lat, p.lng, { zip });
  if (r.spring?.available) registerLayer(p.chapter_id, 'usa-npn');
  if (r.normals?.available) registerLayer(p.chapter_id, 'nasa-power');
  return { place: { id: p.id, name: p.name }, ...r };
}

/** Atlas layers 2 and 3 — what is in the water, and where it goes. */
export async function hydrologyAt(placeId, { radiusKm = 5, sinceYears = 3 } = {}) {
  const p = one('SELECT * FROM places WHERE id=?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null) return { error: 'no_coordinates' };
  const { hydrologyHere } = await import('../adapters/hydrology.mjs');
  const r = await hydrologyHere(p.lat, p.lng, { radiusKm, sinceYears });
  if (r.network?.available) registerLayer(p.chapter_id, 'nhdplus-hr');
  if (r.quality?.available) registerLayer(p.chapter_id, 'water-quality-portal');
  return { place: { id: p.id, name: p.name }, ...r };
}
