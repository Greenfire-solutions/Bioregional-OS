// ── Weather ───────────────────────────────────────────────────────────────
// What the sky is actually doing, and what it is about to do.
//
// Two upstreams, in this order:
//   1. NWS / api.weather.gov — US federal, public domain, no key, no account.
//      Also the only one of the two that carries official hazard alerts.
//   2. Open-Meteo — global coverage, no key, no account (CC-BY-4.0). Used
//      wherever the NWS has none, because a bioregional OS that only works
//      inside one country is not a bioregional OS.
//
// Official hazard alerts are NOT parsed here. They belong to adapters/hazards.mjs
// (Atlas layer 6), which reads the same NWS endpoint; two parsers of one payload
// is exactly the drift the upstream registry exists to prevent. This file calls
// that one and passes its answer through — including its answer when the feed
// could not be reached, because silence is never an all-clear.
//
// Neither is stored beyond the shared on-disk cache, and nothing about the
// chapter is sent upstream except a coordinate rounded to ~100m.
import { getJSON, qs } from './http.mjs';
import { activeAlerts } from './hazards.mjs';
import { markFetched } from './registry.mjs';

const NWS = 'https://api.weather.gov';
const r3 = (n) => Number(n).toFixed(3);        // ~110m — enough to forecast, not enough to locate a person

/** Live conditions + today's forecast + any active hazard, or a stated reason why not. */
export async function weatherNow(lat, lng) {
  try {
    const us = await nws(lat, lng);
    if (us) return us;
  } catch { /* fall through to the global source */ }
  try {
    return await openMeteo(lat, lng);
  } catch (err) {
    return { available: false, reason: `no weather upstream reachable (${err.message})`, source: null };
  }
}

// ── National Weather Service ───────────────────────────────────────────────

async function nws(lat, lng) {
  const { data: point } = await getJSON(`${NWS}/points/${r3(lat)},${r3(lng)}`, {
    ttlMs: 1000 * 60 * 60 * 24 * 30,      // a grid cell does not move
    timeout: 15000,
  });
  const props = point?.properties;
  if (!props?.forecast) return null;      // outside NWS coverage

  const [forecast, hazard, current] = await Promise.all([
    getJSON(props.forecast, { ttlMs: 1000 * 60 * 60 }).catch(() => null),
    activeAlerts(lat, lng).catch((e) => ({ available: false, reason: e.message })),
    latestObservation(props.observationStations).catch(() => null),
  ]);
  markFetched('nws');

  const period = forecast?.data?.properties?.periods?.[0] ?? null;
  const later = forecast?.data?.properties?.periods?.[1] ?? null;

  return {
    available: true,
    source: 'NWS api.weather.gov (US federal, public domain)',
    source_id: 'nws',
    stale: !!forecast?.stale,
    // The IANA zone of the POINT, not of this computer. Someone looking at a
    // place three timezones away should be told that place's sunset.
    timezone: props.timeZone ?? null,
    locality: props.relativeLocation?.properties
      ? `${props.relativeLocation.properties.city}, ${props.relativeLocation.properties.state}`
      : null,
    current,
    forecast: period && {
      name: period.name,
      summary: period.shortForecast,
      detail: period.detailedForecast,
      temperature: period.temperature,
      unit: period.temperatureUnit,
      precipitation_chance: period.probabilityOfPrecipitation?.value ?? null,
      wind: [period.windSpeed, period.windDirection].filter(Boolean).join(' ') || null,
    },
    next: later && { name: later.name, summary: later.shortForecast, temperature: later.temperature, unit: later.temperatureUnit },
    // Alerts are the one thing here that can change what a chapter does today —
    // so an unreachable feed has to read as unreachable, never as "nothing wrong".
    alerts: hazard?.items ?? [],
    alerts_available: hazard?.available === true,
    alerts_note: hazard?.available === true ? null
      : (hazard?.reason ?? 'could not reach the National Weather Service — this is not an all-clear'),
  };
}

async function latestObservation(stationsUrl) {
  if (!stationsUrl) return null;
  const { data: stations } = await getJSON(stationsUrl, { ttlMs: 1000 * 60 * 60 * 24 * 30 });
  const station = stations?.features?.[0];
  if (!station) return null;
  const { data: obs } = await getJSON(`${station.id}/observations/latest`, { ttlMs: 1000 * 60 * 15 });
  const p = obs?.properties;
  if (!p) return null;
  const c = p.temperature?.value;
  return {
    station: station.properties?.name ?? null,
    observed_at: p.timestamp ?? null,
    summary: p.textDescription || null,
    temperature_c: c == null ? null : Math.round(c * 10) / 10,
    temperature_f: c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10,
    humidity: p.relativeHumidity?.value == null ? null : Math.round(p.relativeHumidity.value),
    wind_kph: p.windSpeed?.value == null ? null : Math.round(p.windSpeed.value),
    precip_last_hour_mm: p.precipitationLastHour?.value ?? null,
  };
}

// ── Open-Meteo (global fallback) ───────────────────────────────────────────

async function openMeteo(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?${qs({
    latitude: r3(lat), longitude: r3(lng),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: 'auto', forecast_days: 2,
  })}`;
  const { data, stale } = await getJSON(url, { ttlMs: 1000 * 60 * 60 });
  markFetched('open-meteo');
  const c = data?.current ?? {};
  const d = data?.daily ?? {};
  return {
    available: true,
    source: 'Open-Meteo (global, no account)', source_id: 'open-meteo',
    stale: !!stale,
    timezone: data?.timezone ?? null,
    locality: null,
    current: {
      station: null,
      observed_at: c.time ?? null,
      summary: wmo(c.weather_code),
      temperature_c: c.temperature_2m ?? null,
      temperature_f: c.temperature_2m == null ? null : Math.round((c.temperature_2m * 9 / 5 + 32) * 10) / 10,
      humidity: c.relative_humidity_2m ?? null,
      wind_kph: c.wind_speed_10m ?? null,
      precip_last_hour_mm: c.precipitation ?? null,
    },
    forecast: d.time?.[0] ? {
      name: 'Today',
      summary: wmo(d.weather_code?.[0]),
      detail: null,
      temperature: d.temperature_2m_max?.[0] ?? null,
      unit: 'C',
      precipitation_chance: d.precipitation_probability_max?.[0] ?? null,
      wind: null,
    } : null,
    next: d.time?.[1] ? {
      name: 'Tomorrow', summary: wmo(d.weather_code?.[1]),
      temperature: d.temperature_2m_max?.[1] ?? null, unit: 'C',
    } : null,
    // Open-Meteo carries no official hazard feed. Saying so beats implying all-clear.
    alerts: [],
    alerts_available: false,
    alerts_note: 'No official hazard feed outside US National Weather Service coverage.',
  };
}

const WMO = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail',
  99: 'thunderstorm with hail',
};
const wmo = (code) => (code == null ? null : WMO[code] ?? `code ${code}`);
