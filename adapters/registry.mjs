// ── The upstream registry ─────────────────────────────────────────────────
// One declarative table of every open data source the OS can reach.
//
// This is the one-registry rule (ai/tools.mjs) applied to data instead of
// capabilities, and for the same reason: the moment a licence string, an Atlas
// layer number or a sensitivity default is written down in two places, one of
// them drifts. A drifted tool name is a bug. A drifted licence is a legal
// problem, and the person it lands on is whoever redistributed the export.
//
// So the Atlas legend, the export attribution block, the twelve-layer gap
// report, the heartbeat's cadence and the doctor's connectivity check all read
// from here. Adding a source means adding one entry.
//
// `upstream_sources` in the schema is the persisted face of this table: the
// declaration lives in code, `last_fetched_at` lives in the database.
import { all, one, run, create } from '../core/db.mjs';

/**
 * The twelve Living Commons Atlas layers, from the protocol. Indexed from 1 so
 * the numbers in code match the numbers in the manual.
 */
export const ATLAS_LAYERS = [
  null,
  'Ecoregions',
  'Watersheds and flow direction',
  'Water systems',
  'Land and soil',
  'Habitat and biodiversity',
  'Climate stress and hazards',
  'Human settlement and accessibility',
  'Care and essential systems',
  'Skills, spaces, tools, and institutions',
  'Food, energy, material, labor, money, and information flows',
  'Culture, history, and community memory',
  'Active projects, maintenance, and outcomes',
];

/**
 * Every source, declared once.
 *
 * `sensitivity` is the level a record from this source is created at when the
 * adapter cannot tell whether it is sensitive. It fails CLOSED — 'members', not
 * 'public' — because an adapter that guesses wrong in the other direction
 * publishes something it cannot take back.
 */
export const SOURCES = [
  {
    id: 'epa-ecoregions', layer: 1, kind: 'dataset', coverage: 'us',
    name: 'EPA Ecoregions Level III & IV', project: 'US Environmental Protection Agency',
    license: 'Public domain (US Government)',
    attribution: 'US EPA Ecoregions of North America, Levels III and IV',
    url: 'https://www.epa.gov/eco-research/ecoregions',
    adapter: 'adapters/ecoregion.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://gispub.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/7?f=json',
    expect: 'US_L3NAME',
  },
  {
    id: 'resolve-ecoregions', layer: 1, kind: 'dataset', coverage: 'global',
    name: 'RESOLVE Ecoregions 2017', project: 'RESOLVE / Dinerstein et al.',
    license: 'CC-BY-4.0',
    attribution: 'Dinerstein et al. (2017), RESOLVE Ecoregions 2017 (CC-BY-4.0)',
    url: 'https://ecoregions.appspot.com/',
    adapter: 'adapters/layers.mjs', vendored_path: 'data/upstream/global-ecoregions.geojson',
    cadence: 'vendored', sensitivity: 'public',
    notes: 'Optional drop-in. One Earth Bioregions 2023 is CC-BY-NC and its geometry is never redistributed here.',
    no_probe: 'vendored file, not a service — check the file exists instead',
  },
  {
    id: 'usgs-wbd', layer: 2, kind: 'dataset', coverage: 'us',
    name: 'USGS Watershed Boundary Dataset', project: 'US Geological Survey',
    license: 'Public domain (US Government)',
    attribution: 'USGS Watershed Boundary Dataset (WBD)',
    url: 'https://www.usgs.gov/national-hydrography/watershed-boundary-dataset',
    adapter: 'adapters/watershed.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6?f=json',
  },
  {
    id: 'usgs-nwis', layer: 3, kind: 'api', coverage: 'us',
    name: 'USGS NWIS instantaneous values & daily statistics', project: 'US Geological Survey',
    license: 'Public domain (US Government)',
    attribution: 'USGS National Water Information System',
    url: 'https://waterservices.usgs.gov/',
    adapter: 'adapters/watershed.mjs', cadence: 'every 3 hours', sensitivity: 'public',
    notes: 'The statistics service answers only in RDB; format=json returns HTTP 400.',
    probe: 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08155300&parameterCd=00060',
  },
  {
    id: 'usda-ssurgo', layer: 4, kind: 'api', coverage: 'us',
    name: 'USDA SSURGO via Soil Data Access', project: 'USDA Natural Resources Conservation Service',
    license: 'Public domain (US Government)',
    attribution: 'USDA NRCS Soil Survey Geographic Database (SSURGO), via Soil Data Access',
    url: 'https://sdmdataaccess.nrcs.usda.gov/',
    adapter: 'adapters/soil.mjs', cadence: 'once per place', sensitivity: 'public',
    notes: 'POST only, raw SQL. Longitude first in the WKT point. Errors arrive as OGC XML.',
    probe: {
      url: 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"format":"JSON+COLUMNNAME","query":"SELECT TOP 1 mukey FROM mapunit"}',
    },
    expect: 'Table',
  },
  {
    id: 'isric-soilgrids', layer: 4, kind: 'api', coverage: 'global',
    name: 'ISRIC SoilGrids v2', project: 'ISRIC — World Soil Information',
    license: 'CC-BY-4.0',
    attribution: 'ISRIC SoilGrids 2.0 (CC-BY-4.0)',
    url: 'https://soilgrids.org/',
    adapter: 'adapters/soil.mjs', cadence: 'once per place', sensitivity: 'public',
    notes: 'Values are integers scaled by unit_measure.d_factor. pH 70 means 7.0.',
    probe: 'https://rest.isric.org/soilgrids/v2.0/properties/query?lon=0&lat=0&property=phh2o&depth=0-5cm&value=mean',
    expect: 'layers',
  },
  {
    id: 'usgs-3dep', layer: 4, kind: 'api', coverage: 'us',
    name: 'USGS 3DEP elevation point query', project: 'US Geological Survey',
    license: 'Public domain (US Government)',
    attribution: 'USGS 3D Elevation Program',
    url: 'https://apps.nationalmap.gov/epqs/',
    adapter: 'adapters/soil.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://epqs.nationalmap.gov/v1/json?x=-97.794&y=30.261&units=Meters&wkid=4326&includeDate=false',
  },
  {
    id: 'mrlc-nlcd', layer: 4, kind: 'dataset', coverage: 'us',
    name: 'National Land Cover Database', project: 'MRLC Consortium (USGS)',
    license: 'Public domain (US Government)',
    attribution: 'USGS National Land Cover Database (NLCD)',
    url: 'https://www.mrlc.gov/',
    adapter: 'adapters/soil.mjs', cadence: 'once per place', sensitivity: 'public',
    notes: 'GetFeatureInfo answers with PALETTE_INDEX, which is the NLCD class code.',
    probe: 'https://www.mrlc.gov/geoserver/mrlc_display/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=NLCD_2021_Land_Cover_L48&query_layers=NLCD_2021_Land_Cover_L48&srs=EPSG:4326&bbox=-97.80,30.25,-97.78,30.27&width=10&height=10&x=5&y=5&info_format=application/json',
    expect: 'PALETTE_INDEX',
  },
  {
    id: 'inaturalist', layer: 5, kind: 'api', coverage: 'global',
    name: 'iNaturalist observations', project: 'iNaturalist / California Academy of Sciences',
    license: 'CC0 to CC-BY-NC, per observation',
    attribution: 'iNaturalist community observations',
    url: 'https://www.inaturalist.org/',
    adapter: 'adapters/life.mjs', cadence: 'weekly', sensitivity: 'public',
    notes: 'Species counts carry no coordinates. Threatened taxa are held at restricted anyway — presence in a small box is itself the sensitive fact.',
    probe: 'https://api.inaturalist.org/v1/observations?per_page=1',
  },
  {
    id: 'gbif', layer: 5, kind: 'api', coverage: 'global',
    name: 'GBIF occurrence records', project: 'Global Biodiversity Information Facility',
    license: 'CC0 / CC-BY, per dataset',
    attribution: 'GBIF.org occurrence records',
    url: 'https://www.gbif.org/',
    adapter: 'adapters/life.mjs', cadence: 'weekly', sensitivity: 'public',
    notes: 'Occurrence records carry coordinates. Anything VU/EN/CR is counted, never placed.',
    probe: 'https://api.gbif.org/v1/occurrence/search?limit=0',
  },
  {
    id: 'padus', layer: 5, kind: 'dataset', coverage: 'us',
    name: 'Protected Areas Database of the United States', project: 'USGS Gap Analysis Project',
    license: 'Public domain (US Government)',
    attribution: 'USGS Protected Areas Database of the United States (PAD-US)',
    url: 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview',
    adapter: 'adapters/life.mjs', cadence: 'once per place', sensitivity: 'public',
    notes: 'The USGS host has been answering 502; the USFS mirror covers Forest Service land only.',
    probe: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer?f=json',
  },
  {
    id: 'nws', layer: 6, kind: 'api', coverage: 'us',
    name: 'NOAA National Weather Service', project: 'NOAA',
    license: 'Public domain (US Government)',
    attribution: 'NOAA National Weather Service',
    url: 'https://api.weather.gov/',
    adapter: 'adapters/weather.mjs', cadence: 'hourly', sensitivity: 'public',
    probe: 'https://api.weather.gov/points/30.261,-97.794',
    expect: 'forecastGridData',
  },
  {
    id: 'open-meteo', layer: 6, kind: 'api', coverage: 'global',
    name: 'Open-Meteo', project: 'Open-Meteo',
    license: 'CC-BY-4.0 (free tier is NonCommercial, 10k calls/day)',
    attribution: 'Weather data by Open-Meteo.com (CC-BY-4.0)',
    url: 'https://open-meteo.com/',
    adapter: 'adapters/weather.mjs', cadence: 'hourly', sensitivity: 'public',
    notes: 'Carries no official hazard feed. Prefer the NWS inside the United States.',
    probe: 'https://api.open-meteo.com/v1/forecast?latitude=30.26&longitude=-97.79&current=temperature_2m',
  },
  {
    id: 'fema-nfhl', layer: 6, kind: 'dataset', coverage: 'us',
    name: 'FEMA National Flood Hazard Layer', project: 'Federal Emergency Management Agency',
    license: 'Public domain (US Government)',
    attribution: 'FEMA National Flood Hazard Layer',
    url: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer',
    adapter: 'adapters/hazards.mjs', cadence: 'once per place', sensitivity: 'public',
    notes: 'Regulatory floodplain only. Absence of a zone is not absence of flood risk.',
    probe: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28?f=json',
  },
  {
    id: 'nasa-firms', layer: 6, kind: 'api', coverage: 'global',
    name: 'NASA FIRMS active fire detections', project: 'NASA LANCE',
    license: 'Public domain (US Government)',
    attribution: 'NASA FIRMS (MODIS/VIIRS)',
    url: 'https://firms.modaps.eosdis.nasa.gov/api/',
    adapter: 'adapters/hazards.mjs', cadence: 'hourly', sensitivity: 'public',
    requires_key: 'FIRMS_MAP_KEY',
    no_probe: 'needs a key; absence of a key is not a fault to report as one',
  },
  {
    id: 'usdm', layer: 6, kind: 'api', coverage: 'us',
    name: 'US Drought Monitor', project: 'National Drought Mitigation Center',
    license: 'Public domain',
    attribution: 'US Drought Monitor (NDMC / USDA / NOAA)',
    url: 'https://droughtmonitor.unl.edu/',
    adapter: 'adapters/hazards.mjs', cadence: 'weekly', sensitivity: 'public',
    notes: 'Host resolved but did not answer when this adapter was written. Degrades to unavailable.',
    probe: {
      url: 'https://usdmdataservices.unl.edu/api/USStatistics/GetDroughtSeverityStatisticsByArea?aoi=us&startdate=1/1/2026&enddate=1/8/2026&statisticsType=1',
      headers: { accept: 'application/json' },
    },
    expect: 'mapDate',
  },
  {
    id: 'water-quality-portal', layer: 3, kind: 'api', coverage: 'us',
    name: 'Water Quality Portal', project: 'USGS, EPA and the National Water Quality Monitoring Council',
    license: 'Public domain (US Government)',
    attribution: 'Water Quality Portal (USGS / EPA / NWQMC)',
    url: 'https://www.waterqualitydata.us/',
    adapter: 'adapters/hydrology.mjs', cadence: 'weekly', sensitivity: 'public',
    probe: 'https://www.waterqualitydata.us/data/Station/search?bBox=-97.80,30.25,-97.78,30.27&mimeType=geojson&zip=no',
    expect: 'FeatureCollection',
    notes: 'Answers CSV. Nitrate arrives as both mg/L as N and mg/L as NO3 in the same result set — a median across the two is meaningless and must never be taken.',
  },
  {
    id: 'nhdplus-hr', layer: 2, kind: 'dataset', coverage: 'us',
    name: 'USGS NHDPlus High Resolution', project: 'US Geological Survey',
    license: 'Public domain (US Government)',
    attribution: 'USGS NHDPlus High Resolution',
    url: 'https://www.usgs.gov/national-hydrography/nhdplus-high-resolution',
    adapter: 'adapters/hydrology.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3?f=json',
    expect: 'NetworkNHDFlowline',
    notes: 'Layer 3 is NetworkNHDFlowline. Query by point+distance, not by bounding box — a box is wider at its corners and changes which reach is "nearest" depending on which way the creek runs.',
  },

  // ── layers 7-11: the people, the memory, the growing year ───────────────
  {
    id: 'openstreetmap', layer: 8, kind: 'dataset', coverage: 'global',
    name: 'OpenStreetMap via Overpass', project: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors (ODbL)',
    url: 'https://www.openstreetmap.org/',
    adapter: 'adapters/community.mjs', cadence: 'weekly', sensitivity: 'public',
    probe: 'https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%3Bnode%281%29%3Bout%3B',
    expect: 'osm3s',
    notes: 'Fills layers 7-11 at once. amenity=shelter is a BUS SHELTER — a refuge is social_facility=shelter. Volunteer-maintained: absence is never evidence of absence.',
  },
  {
    id: 'chronicling-america', layer: 11, kind: 'api', coverage: 'us',
    name: 'Chronicling America', project: 'Library of Congress',
    license: 'Public domain',
    attribution: 'Chronicling America, Library of Congress',
    url: 'https://www.loc.gov/collections/chronicling-america/',
    adapter: 'adapters/culture.mjs', cadence: 'on demand', sensitivity: 'public',
    probe: 'https://www.loc.gov/collections/chronicling-america/?q=creek&fo=json&c=1&at=pagination',
    expect: 'pagination',
    notes: 'The old chroniclingamerica.loc.gov API is gone; this is the loc.gov replacement. Use at= to trim, or responses run to megabytes.',
  },
  {
    id: 'openalex', layer: 11, kind: 'api', coverage: 'global',
    name: 'OpenAlex', project: 'OurResearch',
    license: 'CC0',
    attribution: 'OpenAlex (CC0)',
    url: 'https://openalex.org/',
    adapter: 'adapters/culture.mjs', cadence: 'on demand', sensitivity: 'public',
    probe: 'https://api.openalex.org/works?per-page=1',
    expect: 'meta',
  },
  {
    id: 'wikipedia', layer: 11, kind: 'api', coverage: 'global',
    name: 'Wikipedia GeoSearch', project: 'Wikimedia Foundation',
    license: 'CC-BY-SA-4.0',
    attribution: 'Wikipedia contributors (CC-BY-SA 4.0)',
    url: 'https://en.wikipedia.org/',
    adapter: 'adapters/culture.mjs', cadence: 'on demand', sensitivity: 'public',
    probe: 'https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=30.261%7C-97.794&gsradius=1000&gslimit=1&format=json',
    expect: 'geosearch',
  },
  {
    id: 'usa-npn', layer: 6, kind: 'dataset', coverage: 'us',
    name: 'USA National Phenology Network — Extended Spring Indices', project: 'USA-NPN',
    license: 'Public domain',
    attribution: 'USA National Phenology Network, Extended Spring Indices',
    url: 'https://www.usanpn.org/data/spring_indices',
    adapter: 'adapters/phenology.mjs', cadence: 'weekly in spring', sensitivity: 'public',
    probe: 'https://geoserver.usanpn.org/geoserver/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=si-x:30yr_avg_six_leaf&query_layers=si-x:30yr_avg_six_leaf&srs=EPSG:4326&bbox=-97.80,30.25,-97.78,30.27&width=10&height=10&x=5&y=5&info_format=application/json',
    expect: 'LEAF_OUT_DAY',
    notes: 'GeoServer returns -9999 for no-data, which is a number and passes every check that is not looking for it. Unguarded it puts leaf-out in 1997.',
  },
  {
    id: 'usda-hardiness', layer: 4, kind: 'api', coverage: 'us',
    name: 'USDA Plant Hardiness Zone Map', project: 'USDA / Oregon State PRISM',
    license: 'Public domain',
    attribution: 'USDA Plant Hardiness Zone Map',
    url: 'https://planthardiness.ars.usda.gov/',
    adapter: 'adapters/phenology.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://phzmapi.org/78704.json', expect: 'zone',
  },
  {
    id: 'nasa-power', layer: 6, kind: 'api', coverage: 'global',
    name: 'NASA POWER climatology', project: 'NASA Langley',
    license: 'Public domain',
    attribution: 'NASA POWER Project',
    url: 'https://power.larc.nasa.gov/',
    adapter: 'adapters/phenology.mjs', cadence: 'once per place', sensitivity: 'public',
    probe: 'https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M&community=AG&longitude=-97.79&latitude=30.26&format=JSON',
    expect: 'parameter',
  },

  // ── catalogues ──────────────────────────────────────────────────────────
  // Not resolvers. These answer "what does this locality publish?" rather than
  // "what is true at this point?", so they fill no single Atlas layer — they
  // find candidates for many. `kind: 'catalogue'` is how the difference is
  // visible to anything reading this table.
  {
    id: 'socrata', layer: null, kind: 'catalogue', coverage: 'us',
    name: 'Socrata Discovery API', project: 'Tyler Technologies / Socrata',
    license: 'Free API; each dataset carries its own licence',
    attribution: 'Discovered via the Socrata Discovery API',
    url: 'https://socratadiscovery.docs.apiary.io/',
    adapter: 'adapters/discover.mjs', cadence: 'on demand', sensitivity: 'members',
    probe: 'https://api.us.socrata.com/api/catalog/v1?q=water&limit=1',
    expect: 'resultSetSize',
    notes: 'The only catalogue of the two that carries a readable licence string, which is what makes auto-approval possible at all.',
  },
  {
    id: 'arcgis-hub', layer: null, kind: 'catalogue', coverage: 'global',
    name: 'ArcGIS Hub', project: 'Esri',
    license: 'Free API; each dataset carries its own licence',
    attribution: 'Discovered via ArcGIS Hub',
    url: 'https://hub.arcgis.com/',
    adapter: 'adapters/discover.mjs', cadence: 'on demand', sensitivity: 'members',
    probe: 'https://hub.arcgis.com/api/v3/datasets?q=water&page%5Bsize%5D=1',
    expect: 'attributes',
    notes: 'Its licence field reads "none" or "custom" almost everywhere. "none" means nobody filled it in, NOT that the data is free — nothing from here is auto-approvable in practice.',
  },

  // ── supporting sources ──────────────────────────────────────────────────
  // These answer "where is that?" rather than "what is true at this point?", so
  // they fill no Atlas layer. `layer: null` is the explicit way to say so, and
  // registerLayer refuses them rather than writing layer_no NULL into a column
  // the schema constrains to 1-12.
  {
    id: 'nominatim', layer: null, kind: 'api', coverage: 'global',
    name: 'Nominatim', project: 'OpenStreetMap',
    license: 'ODbL',
    attribution: 'Geocoding © OpenStreetMap contributors (ODbL)',
    url: 'https://nominatim.openstreetmap.org/',
    adapter: 'adapters/geocode.mjs', cadence: 'on demand', sensitivity: 'public',
    notes: 'Usage policy: max 1 request/second and a real User-Agent. Both enforced in the adapter. Never bulk-queried.',
    no_probe: 'usage policy caps it at one request per second; a health check is not worth spending that budget',
  },
  {
    id: 'open-meteo-geocoding', layer: null, kind: 'api', coverage: 'global',
    name: 'Open-Meteo geocoding', project: 'Open-Meteo',
    license: 'CC-BY-4.0',
    attribution: 'Geocoding by Open-Meteo.com',
    url: 'https://open-meteo.com/en/docs/geocoding-api',
    adapter: 'adapters/geocode.mjs', cadence: 'on demand', sensitivity: 'public',
    probe: 'https://geocoding-api.open-meteo.com/v1/search?name=Austin&count=1',
  },
  {
    id: 'murmurations', layer: 12, kind: 'protocol', coverage: 'global',
    name: 'Murmurations Protocol', project: 'Murmurations',
    license: 'GPL-3.0 (service); profiles are your own',
    attribution: 'Discovered over the Murmurations network',
    url: 'https://murmurations.network/',
    adapter: 'adapters/murmurations.mjs', cadence: 'on demand', sensitivity: 'public',
    probe: 'https://index.murmurations.network/v2/ping',
  },
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function source(id) { return BY_ID.get(id) ?? null; }

/**
 * A cheap, side-effect-free request that proves a source is answering.
 *
 * Deliberately NOT the same as `url`. `url` is the source's home page — the
 * right thing to show a person and the wrong thing to call: it is heavy, it is
 * often a redirect, and it being up says nothing about whether the API behind
 * it is. A probe is the smallest real question the service can be asked.
 *
 * Returns `{ url, method, headers, body }` or null. A null probe is not a gap:
 * `no_probe` records WHY, because "needs a key" and "we forgot" look identical
 * in a report that only shows absence.
 */
export function probeFor(id) {
  const s = BY_ID.get(id);
  if (!s?.probe) return null;
  const base = typeof s.probe === 'string'
    ? { url: s.probe, method: 'GET', headers: {}, body: null }
    : { method: 'GET', headers: {}, body: null, ...s.probe };
  // `expect` exists because for several of these HTTP 200 is not proof.
  // Verified, both returning 200 while completely broken:
  //   • MRLC answers a bad layer name with an XML ServiceExceptionReport
  //   • the Drought Monitor answers CSV when content negotiation fails
  // A status-only health check calls both of those healthy while the adapter
  // downstream is choking on an unparseable body. If `expect` is set, the
  // response text has to contain it for the source to count as answering.
  return { ...base, expect: s.expect ?? null };
}

/** Everything that can be health-checked, and everything that deliberately cannot. */
export function probes() {
  return {
    probeable: SOURCES.filter((s) => s.probe).map((s) => ({ id: s.id, name: s.name, ...probeFor(s.id) })),
    unprobeable: SOURCES.filter((s) => !s.probe)
      .map((s) => ({ id: s.id, name: s.name, why: s.no_probe ?? 'no probe declared yet' })),
  };
}
export function sourcesForLayer(layer) { return SOURCES.filter((s) => s.layer === layer); }

/** The level a record from this source is created at when nothing else is known. */
export function defaultSensitivity(id) { return BY_ID.get(id)?.sensitivity ?? 'members'; }

/** Which sources need a key this machine does not have. */
export function missingKeys(env = process.env) {
  return SOURCES.filter((s) => s.requires_key && !env[s.requires_key])
    .map((s) => ({ id: s.id, name: s.name, env_var: s.requires_key }));
}

/**
 * Write the declaration into the database so it can be queried, joined and
 * exported alongside the data it produced. Safe to run on every boot.
 */
export function syncSources() {
  let added = 0;
  for (const s of SOURCES) {
    const existing = one('SELECT id FROM upstream_sources WHERE id=?', s.id);
    const row = {
      name: s.name, project: s.project, kind: s.kind, license: s.license,
      url: s.url, adapter: s.adapter ?? null, vendored_path: s.vendored_path ?? null,
      notes: s.notes ?? null,
    };
    if (existing) {
      run(`UPDATE upstream_sources SET name=?, project=?, kind=?, license=?, url=?,
             adapter=?, vendored_path=?, notes=? WHERE id=?`,
          row.name, row.project, row.kind, row.license, row.url,
          row.adapter, row.vendored_path, row.notes, s.id);
    } else {
      run(`INSERT INTO upstream_sources (id,name,project,kind,license,url,adapter,vendored_path,notes)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          s.id, row.name, row.project, row.kind, row.license, row.url,
          row.adapter, row.vendored_path, row.notes);
      added++;
    }
  }
  return { total: SOURCES.length, added };
}

let synced = false;
/**
 * The declaration has to be in the table before anything can stamp a fetch time
 * onto it, and adapters run long before anyone opens the sources view. Sync on
 * first use, once per process.
 */
function ensureSynced() {
  if (synced) return;
  try { syncSources(); synced = true; } catch { /* no database open yet */ }
}

/** Record that this source actually answered. The difference between declared and reachable. */
export function markFetched(id) {
  try {
    ensureSynced();
    run(`UPDATE upstream_sources SET last_fetched_at=datetime('now') WHERE id=?`, id);
  } catch { /* no database in this process; the data still stands */ }
}

/**
 * Register an Atlas layer against the source that filled it, so
 * list_atlas_layers stops being a list of what somebody remembered to type and
 * becomes a report of what this chapter can actually see, licence attached.
 */
export function registerLayer(chapterId, sourceId, { geojson_path = null, notes = null, layer = null } = {}) {
  const s = BY_ID.get(sourceId);
  if (!s || !chapterId) return null;
  // A source can legitimately fill more than one layer — OpenStreetMap fills
  // four — so the caller may name which. It still has to be a real layer.
  const layerNo = layer ?? s.layer;
  if (!(layerNo >= 1 && layerNo <= 12)) return null;
  // A supporting source (geocoding, and anything else that answers "where is
  // that?") fills no Atlas layer. Refuse rather than write NULL into layer_no,
  // which the schema constrains to 1-12 — the insert would throw at the worst
  // possible moment, inside a successful resolve.
  if (s.layer == null && layer == null) return null;
  const existing = one(
    `SELECT id FROM atlas_layers WHERE chapter_id=? AND layer_no=? AND source=?`,
    chapterId, layerNo, s.name);
  if (existing) {
    run(`UPDATE atlas_layers SET source_license=?, updated_at=datetime('now'),
           geojson_path=coalesce(?, geojson_path), notes=coalesce(?, notes) WHERE id=?`,
        s.license, geojson_path, notes ?? s.notes ?? null, existing.id);
    markFetched(sourceId);
    return one('SELECT * FROM atlas_layers WHERE id=?', existing.id);
  }
  const row = create('atlas_layers', 'atlas_layer', chapterId, {
    chapter_id: chapterId, layer_no: layerNo, name: ATLAS_LAYERS[layerNo],
    source: s.name, source_license: s.license,
    geojson_path, notes: notes ?? s.notes ?? null,
  }, s.sensitivity ?? 'public');
  markFetched(sourceId);
  return row;
}

/**
 * Register an Atlas layer for a dataset that was DISCOVERED rather than
 * declared — a city portal's own data, approved by a person or by its licence.
 *
 * Separate from registerLayer because the provenance is different and has to
 * stay visible: a declared source was vetted when it was written into SOURCES,
 * a discovered one was vetted by whoever approved it, and the export needs to
 * be able to say which.
 */
export function registerDiscovered(chapterId, dataset, { sensitivity = 'members' } = {}) {
  if (!chapterId || !dataset?.atlas_layer) return null;
  const existing = one(
    `SELECT id FROM atlas_layers WHERE chapter_id=? AND layer_no=? AND source=?`,
    chapterId, dataset.atlas_layer, dataset.title);
  if (existing) {
    run(`UPDATE atlas_layers SET source_license=?, notes=?, updated_at=datetime('now') WHERE id=?`,
        dataset.license_raw ?? 'unstated', discoveredNote(dataset), existing.id);
    return one('SELECT * FROM atlas_layers WHERE id=?', existing.id);
  }
  return create('atlas_layers', 'atlas_layer', chapterId, {
    chapter_id: chapterId, layer_no: dataset.atlas_layer,
    name: ATLAS_LAYERS[dataset.atlas_layer],
    source: dataset.title,
    source_license: dataset.license_raw ?? 'unstated',
    geojson_path: dataset.api_url ?? null,
    notes: discoveredNote(dataset),
  }, sensitivity);
}

const discoveredNote = (d) =>
  [`Discovered on ${d.portal ?? 'a local portal'}`,
   d.publisher ? `published by ${d.publisher}` : null,
   // Why it landed on THIS layer, so a wrong guess is arguable rather than mysterious.
   d.layer_match?.matched ? `filed under layer ${d.atlas_layer} on "${d.layer_match.matched}" in the ${d.layer_match.from}` : null,
   d.source_url,
   d.reviewed_by ? `approved by ${d.reviewed_by}` : null,
  ].filter(Boolean).join(' · ');

/**
 * The twelve-layer gap report: what is declared available, what this chapter has
 * actually resolved, and what nothing upstream can fill.
 */
export function layerCoverage(chapterId) {
  const registered = chapterId
    ? all('SELECT * FROM atlas_layers WHERE chapter_id=? ORDER BY layer_no', chapterId)
    : [];
  const have = new Set(registered.map((r) => r.layer_no));
  return ATLAS_LAYERS.slice(1).map((name, i) => {
    const no = i + 1;
    const avail = sourcesForLayer(no);
    return {
      layer_no: no,
      name,
      resolved: have.has(no),
      registered: registered.filter((r) => r.layer_no === no)
        .map((r) => ({ source: r.source, license: r.source_license, sensitivity: r.sensitivity })),
      available_upstream: avail.map((s) => ({
        id: s.id, name: s.name, license: s.license, coverage: s.coverage,
        needs_key: s.requires_key ?? null,
      })),
      // Layer 12 is the commons' own work. Nothing upstream belongs in it.
      note: no === 12 ? 'This layer is the chapter\'s own quests and measurements.'
        : avail.length ? null : 'No open upstream wired for this layer yet.',
    };
  });
}

/**
 * Which registry source wrote a signal, from the short `source_adapter` tag it
 * carries. Tags are short ('usgs') and registry ids are long ('usgs-nwis'), so
 * something has to join them — and a join is exactly where a credit goes
 * missing quietly.
 */
export const ADAPTER_SOURCE = {
  usgs: 'usgs-nwis', nws: 'nws', firms: 'nasa-firms', usdm: 'usdm',
  inaturalist: 'inaturalist', gbif: 'gbif', osm: 'openstreetmap',
};

/**
 * The credit block any artifact LEAVING THE MACHINE has to carry.
 *
 * A screen missing a credit is a bug a reader might notice. An artifact missing
 * one is a licence breach in something already in someone else's hands — and a
 * knowledge bundle is the worst case, because it is designed to travel between
 * chapters and becomes their problem rather than stopping at one group chat.
 *
 * Anything unresolvable is NAMED, never dropped: an artifact missing one credit
 * is otherwise indistinguishable from one that needed none.
 */
export function creditForTags(tags, { humanTags = [] } = {}) {
  const ids = [], unresolved = [];
  let ownWork = false;
  for (const tag of new Set([...tags].filter(Boolean))) {
    if (humanTags.includes(tag)) { ownWork = true; continue; }
    const id = ADAPTER_SOURCE[tag];
    if (id && BY_ID.has(id)) ids.push(id);
    else unresolved.push(tag);
  }
  const attribution = attributionFor(ids);
  if (ownWork) {
    attribution.unshift({
      source: "This chapter's own observations",
      license: 'Held by the commons that recorded them', attribution: null, url: null,
    });
  }
  return {
    attribution,
    unresolved_sources: unresolved.length ? unresolved : null,
    notice: unresolved.length
      ? `Some of this came from sources this OS could not resolve to a licence (${unresolved.join(', ')}). Check their terms before passing it on.`
      : 'Every source here is credited above. Honour the terms shown.',
  };
}

/** The attribution block an export has to carry. Built from what was actually used. */
export function attributionFor(ids = []) {
  const seen = new Set();
  const lines = [];
  for (const id of ids) {
    const s = BY_ID.get(id);
    if (!s || seen.has(id)) continue;
    seen.add(id);
    lines.push({ source: s.name, license: s.license, attribution: s.attribution, url: s.url });
  }
  return lines;
}
