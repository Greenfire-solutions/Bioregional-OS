// ── Watershed resolution + live water signals ─────────────────────────────
// Upstream (both US federal, public domain — no license friction):
//   USGS Watershed Boundary Dataset (WBD) — HUC12 subwatershed for a point
//   USGS NWIS Instantaneous Values       — real-time discharge / gage height
// The manual organizes water work by watershed; this is what makes that literal.
import { getJSON, qs } from './http.mjs';

const WBD = 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer';

/** HUC12 subwatershed (and HUC8 subbasin) containing a point. */
export async function resolveWatershed(lat, lng) {
  const layerQuery = async (layer, fields) => {
    const url = `${WBD}/${layer}/query?${qs({
      geometry: { x: lng, y: lat, spatialReference: { wkid: 4326 } },
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: fields,
      returnGeometry: false,
      f: 'json',
    })}`;
    const { data } = await getJSON(url, { ttlMs: 1000 * 60 * 60 * 24 * 90 });
    return data?.features?.[0]?.attributes ?? null;
  };
  const sub = await layerQuery(6, 'huc12,name').catch(() => null);
  const basin = await layerQuery(4, 'huc8,name').catch(() => null);
  if (!sub && !basin) return null;
  return {
    watershed_huc: sub?.huc12 ?? basin?.huc8 ?? null,
    watershed_name: sub?.name ?? basin?.name ?? null,
    subbasin_huc: basin?.huc8 ?? null,
    subbasin_name: basin?.name ?? null,
    source: 'USGS Watershed Boundary Dataset (public domain)',
  };
}

/**
 * Live gage readings near a place, shaped as BioRegional OS signals.
 * 00060 = discharge (cfs), 00065 = gage height (ft).
 */
export async function waterSignals(lat, lng, { radiusDeg = 0.15 } = {}) {
  const bbox = [
    (lng - radiusDeg).toFixed(4), (lat - radiusDeg).toFixed(4),
    (lng + radiusDeg).toFixed(4), (lat + radiusDeg).toFixed(4),
  ].join(',');
  const url = `https://waterservices.usgs.gov/nwis/iv/?${qs({
    format: 'json', bBox: bbox, parameterCd: '00060,00065', siteStatus: 'active',
  })}`;
  const { data, stale } = await getJSON(url, { ttlMs: 1000 * 60 * 20 });
  const series = data?.value?.timeSeries ?? [];
  return series.map((ts) => {
    const v = ts.values?.[0]?.value?.[0];
    const loc = ts.sourceInfo?.geoLocation?.geogLocation ?? {};
    return {
      title: `${ts.sourceInfo?.siteName ?? 'USGS gage'} — ${ts.variable?.variableName?.split(',')[0] ?? ''}`.trim(),
      category: 'Hydrological',
      severity: 'Info',
      location_name: ts.sourceInfo?.siteName ?? null,
      lat: loc.latitude ?? null,
      lng: loc.longitude ?? null,
      description: ts.variable?.variableDescription ?? null,
      author: 'USGS NWIS (automated)',
      verified: 1,
      observed_at: v?.dateTime ?? null,
      quantity_value: v?.value != null ? Number(v.value) : null,
      quantity_unit: ts.variable?.unit?.unitCode ?? null,
      source_adapter: 'usgs',
      source_ref: ts.sourceInfo?.siteCode?.[0]?.value ?? null,
    };
  }).filter((s) => Number.isFinite(s.quantity_value) && s.quantity_value !== -999999);
}
