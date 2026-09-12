// ── Who observed it ───────────────────────────────────────────────────────
// One declaration of which signals a PERSON put there.
//
// Every adapter writes into the same `signals` table a human observation goes
// into — USGS gages, NOAA alerts, FIRMS fire detections, drought classes,
// imported field data. That is the right design: one stream, one map, one set
// of protocol gates. But it means any question of the form "what did people
// notice?" needs to know the difference, and getting it wrong is quiet.
//
// The list below is HUMAN sources, not automated ones, and that direction is
// deliberate. If it listed the machines, every new adapter would have to
// remember to add itself, and the failure mode of forgetting would be crediting
// a person for something NOAA issued — quiet, flattering, and wrong. Listed the
// other way round, a new automated source is excluded by default and the worst
// that happens is an observation waits to be counted.
//
// "Because of you, the council acted" is a much worse thing to say falsely than
// to leave unsaid.

/**
 * Sources that mean a person was there.
 *   manual    — typed into the interface
 *   notice    — the one-line daily prompt
 *   assistant — recorded by the assistant because a person asked it to
 *   comapeo   — carried back from the field in CoMapeo
 *   geojson   — imported from a survey somebody did
 */
export const HUMAN_SOURCES = Object.freeze(['manual', 'notice', 'assistant', 'comapeo', 'geojson']);

const HUMAN = new Set(HUMAN_SOURCES);

/** True when a person, not an upstream service, put this observation here. */
export function humanObserved(sourceAdapter) {
  // A signal with no source at all predates the adapters and was typed by hand.
  return sourceAdapter == null || HUMAN.has(String(sourceAdapter));
}

/**
 * The same rule as SQL, so a query and a filter can never disagree.
 * Inlined as literals rather than bound parameters so it composes into a WHERE
 * clause without the caller having to thread the right number of arguments
 * through — the values are a frozen constant in this file, never user input.
 */
export function humanObservedSql(column = 'source_adapter') {
  const list = HUMAN_SOURCES.map((s) => `'${s}'`).join(', ');
  return `(${column} IS NULL OR ${column} IN (${list}))`;
}

/** The inverse, for "what did the land report on its own?" */
export function automatedSql(column = 'source_adapter') {
  return `NOT ${humanObservedSql(column)}`;
}

/**
 * Is this observation's coordinate its OWN, or borrowed from the place it was
 * filed against?
 *
 * A different question from `humanObserved`, and the one a map pin actually
 * answers. A USGS gage is bolted to a spot and its coordinate is the most
 * precise in the table; a NOAA advisory covering sixteen counties is filed at
 * the place's point, and so is a one-line notice typed at the kitchen table.
 * Splitting those by who observed them gets it backwards in both directions —
 * the gage becomes vague and the notice becomes precise.
 *
 * Exact equality is correct: a borrowed coordinate is copied verbatim from the
 * place row, never computed, so there is no floating-point drift to allow for.
 *
 * Lives here rather than in the one query that first needed it, so the map, the
 * REST API and a GeoJSON export bound for QGIS cannot come to different
 * conclusions about the same row.
 */
export function atPlaceCentroidSql(alias = 's') {
  return `EXISTS (SELECT 1 FROM places p
                   WHERE p.chapter_id = ${alias}.chapter_id
                     AND p.lat = ${alias}.lat AND p.lng = ${alias}.lng)`;
}

/** The same test for a row already in hand, against the places already loaded. */
export function atPlaceCentroid(signal, places = []) {
  if (signal?.lat == null || signal?.lng == null) return false;
  return places.some((p) => p.lat === signal.lat && p.lng === signal.lng);
}
