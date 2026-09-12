// ── Climate ───────────────────────────────────────────────────────────────
// Open-Meteo historical reanalysis — free, no key, CC-BY 4.0.
// Ten years of daily data reduced to monthly normals plus the extremes a
// bioregion actually plans around: heat, frost, dry spells, wettest month.
import { getJSON, qs } from './http.mjs';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

export async function climateNormals(lat, lng, { years = 10 } = {}) {
  const end = new Date(); end.setDate(end.getDate() - 7);   // the archive lags a few days
  const start = new Date(end); start.setFullYear(end.getFullYear() - years);
  const iso = (d) => d.toISOString().slice(0, 10);

  const { data, stale } = await getJSON(`${ARCHIVE}?${qs({
    latitude: lat, longitude: lng,
    start_date: iso(start), end_date: iso(end),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'auto',
  })}`, { ttlMs: 1000 * 60 * 60 * 24 * 180, timeout: 90000 });

  const d = data?.daily;
  if (!d?.time?.length) return null;

  const months = Array.from({ length: 12 }, () => ({ tmax: [], tmin: [], precip: [] }));
  let frostDays = 0, hotDays = 0, wetDays = 0, longestDry = 0, dryRun = 0;

  for (let i = 0; i < d.time.length; i++) {
    const m = Number(d.time[i].slice(5, 7)) - 1;
    const tx = d.temperature_2m_max[i], tn = d.temperature_2m_min[i], pr = d.precipitation_sum[i];
    if (tx != null) { months[m].tmax.push(tx); if (tx >= 35) hotDays++; }
    if (tn != null) { months[m].tmin.push(tn); if (tn <= 0) frostDays++; }
    if (pr != null) {
      months[m].precip.push(pr);
      if (pr >= 1) { wetDays++; dryRun = 0; } else { dryRun++; longestDry = Math.max(longestDry, dryRun); }
    }
  }

  const NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthly = months.map((m, i) => ({
    month: NAMES[i],
    mean_high_c: avg(m.tmax), mean_low_c: avg(m.tmin),
    mean_precip_mm: m.precip.length ? Number((sum(m.precip) / years).toFixed(1)) : null,
  }));
  const wettest = monthly.reduce((a, b) => ((b.mean_precip_mm ?? -1) > (a.mean_precip_mm ?? -1) ? b : a));
  const driest = monthly.reduce((a, b) => ((b.mean_precip_mm ?? 1e9) < (a.mean_precip_mm ?? 1e9) ? b : a));

  return {
    at: [lat, lng], years, source: 'Open-Meteo historical reanalysis (CC-BY 4.0)',
    stale: !!stale,
    monthly,
    annual_precip_mm: Number((monthly.reduce((s2, m) => s2 + (m.mean_precip_mm ?? 0), 0)).toFixed(0)),
    frost_days_per_year: Number((frostDays / years).toFixed(1)),
    days_over_35c_per_year: Number((hotDays / years).toFixed(1)),
    rain_days_per_year: Number((wetDays / years).toFixed(0)),
    longest_dry_spell_days: longestDry,
    wettest_month: wettest.month, driest_month: driest.month,
  };
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? Number((sum(a) / a.length).toFixed(1)) : null);
