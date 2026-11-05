// ── Sky ───────────────────────────────────────────────────────────────────
// Sun and moon, computed on this machine. No network, no key, no upstream —
// which means this is the one part of "the land today" that can never be
// stale, rate-limited, or unavailable in a valley with no signal.
//
// Algorithm: NOAA Solar Calculator (public domain), the same equations the
// USNO tables are built from. Accurate to about a minute for latitudes under
// 72°, which is well inside the tolerance of "sunset is four minutes earlier
// than yesterday".
//
// Why this is in an OS for a commons at all: the protocol asks a chapter to
// name its seasonal risks and baseline. Daylight, and the direction daylight
// is moving, is the cheapest true seasonal fact there is.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_DAY = 86_400_000;

const mod360 = (x) => ((x % 360) + 360) % 360;

/** Julian day for an instant. */
function julian(date) {
  return date.getTime() / MS_DAY + 2440587.5;
}

/**
 * Solar position terms for an instant.
 * Returns declination (°), the equation of time (minutes) and the sun's
 * apparent ecliptic longitude (°) — the last is what dates the solstices.
 */
function solar(date) {
  const t = (julian(date) - 2451545.0) / 36525;              // Julian centuries since J2000
  const L0 = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
          + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t)
          + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = e0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) * DEG;

  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (
      y * Math.sin(2 * L0 * RAD)
    - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD)
    - 1.25 * e * e * Math.sin(2 * M * RAD)
  );
  return { decl, eqTime, appLong: mod360(appLong) };
}

/**
 * Sunrise, solar noon and sunset for the solar day containing `date`.
 * Returns Date objects, or nulls above the arctic/antarctic circles where the
 * sun does not cross the horizon that day — which is a real answer, not a bug.
 */
export function sunTimes(date, lat, lng) {
  // Work on the *solar* day at this longitude, not the UTC day, so places a
  // long way from Greenwich don't get yesterday's numbers after dark.
  const shifted = new Date(date.getTime() + lng * 4 * 60_000);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const noonGuess = new Date(Date.UTC(y, m, d, 12, 0, 0));
  const { decl, eqTime } = solar(noonGuess);

  const noonMin = 720 - 4 * lng - eqTime;                    // minutes UTC
  const cosHA = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD))
              - Math.tan(lat * RAD) * Math.tan(decl * RAD);

  const midnight = Date.UTC(y, m, d, 0, 0, 0);
  const at = (min) => new Date(midnight + min * 60_000);

  if (cosHA > 1) return { sunrise: null, sunset: null, solar_noon: at(noonMin), polar: 'night', declination: decl };
  if (cosHA < -1) return { sunrise: null, sunset: null, solar_noon: at(noonMin), polar: 'day', declination: decl };

  const ha = Math.acos(cosHA) * DEG;
  return {
    sunrise: at(noonMin - 4 * ha),
    sunset: at(noonMin + 4 * ha),
    solar_noon: at(noonMin),
    polar: null,
    declination: decl,
  };
}

/** Daylight in seconds, or null during polar day/night. */
export function daylightSeconds(date, lat, lng) {
  const t = sunTimes(date, lat, lng);
  if (!t.sunrise || !t.sunset) return t.polar === 'day' ? 86400 : 0;
  return Math.round((t.sunset - t.sunrise) / 1000);
}

/**
 * Moon age, illuminated fraction and phase name.
 * Mean-phase approximation — within a few hours of the true new moon, which is
 * plenty for "waxing gibbous, 71% lit".
 */
export function moon(date) {
  const SYNODIC = 29.530588853;
  const age = (((julian(date) - 2451550.1) % SYNODIC) + SYNODIC) % SYNODIC;
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  const NAMES = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous',
                 'full', 'waning gibbous', 'last quarter', 'waning crescent'];
  // Octants centred on the named phases, so "full" covers the days either side.
  const idx = Math.floor(((age / SYNODIC) * 8 + 0.5) % 8);
  return {
    age_days: Math.round(age * 10) / 10,
    illumination: Math.round(illumination * 100) / 100,
    phase: NAMES[idx],
  };
}

/**
 * The next solstice or equinox, found by walking the sun's apparent longitude
 * until it crosses a multiple of 90° and then bisecting. Exact to the minute,
 * and it needs nothing but arithmetic.
 */
export function nextSolarEvent(date = new Date()) {
  const NAMES = { 0: 'March equinox', 90: 'June solstice', 180: 'September equinox', 270: 'December solstice' };
  const target = (lon) => Math.floor(lon / 90) * 90;

  let prev = new Date(date);
  let prevLon = solar(prev).appLong;
  for (let i = 1; i <= 400; i++) {
    const next = new Date(date.getTime() + i * MS_DAY);
    const lon = solar(next).appLong;
    // A crossing is any day where the 90° bucket changes (including the wrap at 360→0).
    if (target(lon) !== target(prevLon)) {
      const crossing = mod360(target(lon) === 0 ? 0 : target(lon));
      let lo = prev, hi = next;
      for (let k = 0; k < 30; k++) {
        const mid = new Date((lo.getTime() + hi.getTime()) / 2);
        const dl = mod360(solar(mid).appLong - crossing + 180) - 180;
        if (dl < 0) lo = mid; else hi = mid;
      }
      return {
        name: NAMES[crossing] ?? 'solstice',
        at: hi.toISOString(),
        days_away: Math.round((hi - date) / MS_DAY),
      };
    }
    prev = next; prevLon = lon;
  }
  return null;
}

/** Everything the sky knows about one point today, ready to render. */
export function skyToday(lat, lng, now = new Date()) {
  const today = sunTimes(now, lat, lng);
  const todaySec = daylightSeconds(now, lat, lng);
  const yesterdaySec = daylightSeconds(new Date(now.getTime() - MS_DAY), lat, lng);
  const delta = todaySec - yesterdaySec;

  return {
    sunrise: today.sunrise?.toISOString() ?? null,
    sunset: today.sunset?.toISOString() ?? null,
    solar_noon: today.solar_noon?.toISOString() ?? null,
    polar: today.polar,
    daylight_seconds: todaySec,
    daylight: hms(todaySec),
    // The number nobody else will tell you, and the reason to look tomorrow.
    daylight_change_seconds: delta,
    daylight_change: `${delta >= 0 ? 'gaining' : 'losing'} ${hms(Math.abs(delta), true)} a day`,
    moon: moon(now),
    next_turn: nextSolarEvent(now),
    computed: 'locally — NOAA solar equations, no network',
  };
}

function hms(sec, short = false) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (short) return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
