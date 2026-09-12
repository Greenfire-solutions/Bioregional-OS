// ── Engine: Bioregional ───────────────────────────────────────────────────
// Mandate: observe land, water, climate, species, food, energy, materials.
// Output: seasonal dashboard and priority map.
import { all, one, create, run } from '../core/db.mjs';
import { resolveEcoregion } from '../adapters/ecoregion.mjs';
import { resolveWatershed, waterSignals } from '../adapters/watershed.mjs';

/** Stage 1 — Locate. Resolve a place against open reference data. */
export async function locate(placeId) {
  const p = one('SELECT * FROM places WHERE id = ?', placeId);
  if (!p) return { error: 'not_found' };
  if (p.lat == null || p.lng == null) return { error: 'no_coordinates' };

  const [eco, wshed] = await Promise.all([
    resolveEcoregion(p.lat, p.lng).catch(() => null),
    resolveWatershed(p.lat, p.lng).catch(() => null),
  ]);
  run(
    `UPDATE places SET ecoregion_name=COALESCE(?,ecoregion_name),
       bioregion_name=COALESCE(?,bioregion_name), biome=COALESCE(?,biome),
       realm=COALESCE(?,realm), watershed_huc=COALESCE(?,watershed_huc),
       watershed_name=COALESCE(?,watershed_name) WHERE id=?`,
    eco?.ecoregion_name ?? null, eco?.bioregion_name ?? null, eco?.biome ?? null,
    eco?.level2_name ?? null, wshed?.watershed_huc ?? null, wshed?.watershed_name ?? null,
    placeId
  );
  return { place: one('SELECT * FROM places WHERE id = ?', placeId), ecoregion: eco, watershed: wshed };
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
  const unverified = one(
    `SELECT COUNT(*) n FROM signals WHERE chapter_id=? AND verified=0`, chapterId)?.n ?? 0;
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
    unverified_signals: unverified,
    quests_by_stage: Object.fromEntries(questsByStage.map((r) => [r.stage, r.n])),
    indicators_overdue: overdueIndicators,
    water_last_seen: one(
      `SELECT MAX(observed_at) t FROM signals WHERE chapter_id=? AND source_adapter='usgs'`, chapterId)?.t ?? null,
  };
}
