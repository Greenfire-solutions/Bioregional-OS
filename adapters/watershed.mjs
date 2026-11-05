// ── Watershed resolution + live water signals ─────────────────────────────
// Upstream (both US federal, public domain — no license friction):
//   USGS Watershed Boundary Dataset (WBD) — HUC12 subwatershed for a point
//   USGS NWIS Instantaneous Values       — real-time discharge / gage height
// The manual organizes water work by watershed; this is what makes that literal.
import { getJSON, getText, qs } from './http.mjs';

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
    source: 'USGS Watershed Boundary Dataset', source_id: 'usgs-wbd',
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

/**
 * A gage reading on its own is a number. A gage reading against its own history
 * is news — and news is the only thing that earns a second visit.
 *
 * Two free USGS services, no account:
 *   • NWIS IV, period=P7D   → what this gage has done this week
 *   • NWIS statistics (RDB) → the median for THIS CALENDAR DAY across the whole
 *     period of record, so "low" means low for a September, not low for a June.
 */
export async function gageContext(siteCode, { parameterCd = '00060' } = {}) {
  if (!siteCode) return null;
  const out = { site: siteCode, parameter: parameterCd };

  // ---- this week ----
  try {
    const url = `https://waterservices.usgs.gov/nwis/iv/?${qs({
      format: 'json', sites: siteCode, parameterCd, period: 'P7D',
    })}`;
    const { data, stale } = await getJSON(url, { ttlMs: 1000 * 60 * 30 });
    const ts = data?.value?.timeSeries?.[0];
    const points = (ts?.values?.[0]?.value ?? [])
      .map((v) => Number(v.value))
      .filter((v) => Number.isFinite(v) && v !== -999999);
    if (points.length) {
      const sorted = [...points].sort((a, b) => a - b);
      out.site_name = ts?.sourceInfo?.siteName ?? null;
      out.unit = ts?.variable?.unit?.unitCode ?? null;
      out.current = points[points.length - 1];
      out.week_median = median(sorted);
      out.week_min = sorted[0];
      out.week_max = sorted[sorted.length - 1];
      out.week_change_pct = out.week_median ? Math.round(((out.current - out.week_median) / out.week_median) * 100) : null;
      out.lowest_this_week = out.current <= out.week_min;
      out.highest_this_week = out.current >= out.week_max;
      out.stale = !!stale;
    }
  } catch (err) { out.week_error = err.message; }

  // ---- this calendar day, across the record ----
  try {
    const url = `https://waterservices.usgs.gov/nwis/stat/?${qs({
      format: 'rdb', sites: siteCode, statReportType: 'daily',
      statTypeCd: 'p10,median,p90', parameterCd,
    })}`;
    const { data } = await getText(url, { ttlMs: 1000 * 60 * 60 * 24 * 30 });
    const today = new Date();
    const row = findDailyStat(data, today.getMonth() + 1, today.getDate());
    if (row) {
      out.day_of_year_median = row.median;
      out.day_of_year_p10 = row.p10;
      out.day_of_year_p90 = row.p90;
      out.years_of_record = row.count ?? null;
      if (out.current === 0) {
        // An intermittent creek reading zero is not a missing number, it is the news.
        out.standing = row.median === 0
          ? 'dry — as it usually is on this date'
          : 'dry, and it is not usually dry on this date';
      } else if (out.current != null && row.median) {
        out.vs_median_pct = Math.round(((out.current - row.median) / row.median) * 100);
        out.standing = out.current < (row.p10 ?? -Infinity) ? 'below the 10th percentile for this date'
          : out.current > (row.p90 ?? Infinity) ? 'above the 90th percentile for this date'
          : out.vs_median_pct <= -15 ? 'below median for this date'
          : out.vs_median_pct >= 15 ? 'above median for this date'
          : 'about median for this date';
      }
    }
  } catch (err) { out.stat_error = err.message; }

  out.source = 'USGS NWIS (public domain)';
  out.source_id = 'usgs-nwis';
  return out.current == null ? null : out;
}

/**
 * Parse one day's row out of an NWIS RDB table.
 * Exported under a test name so the two traps below can be proven without a
 * network call — both of them are silent when they break.
 */
export function findDailyStat(rdb, month, day) {
  const lines = String(rdb).replace(/\r/g, '').split('\n');
  const header = lines.find((l) => l.startsWith('agency_cd'));
  if (!header) return null;
  const cols = header.split('\t');
  const idx = (name) => cols.indexOf(name);
  const iMonth = idx('month_nu'), iDay = idx('day_nu');
  if (iMonth < 0 || iDay < 0) return null;

  for (const line of lines) {
    if (!line || line.startsWith('#') || line.startsWith('agency_cd') || line.startsWith('5s')) continue;
    const f = line.split('\t');
    if (Number(f[iMonth]) !== month || Number(f[iDay]) !== day) continue;
    const num = (name) => {
      const i = idx(name);
      // A blank RDB cell is an absent statistic, not zero — and Number('') is 0,
      // which would silently turn "no 90th percentile on record" into a flood.
      const raw = i >= 0 ? String(f[i] ?? '').trim() : '';
      if (!raw) return null;
      const v = Number(raw);
      return Number.isFinite(v) ? v : null;
    };
    // The service labels the median p50_va; older responses used median_va.
    return { median: num('p50_va') ?? num('median_va'), p10: num('p10_va'), p90: num('p90_va'), count: num('count_nu') };
  }
  return null;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
