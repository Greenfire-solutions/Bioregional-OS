// Shared fetch with timeout + a small on-disk cache, so the OS stays usable offline.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../core/db.mjs';

const CACHE = join(ROOT, 'data', 'upstream', 'cache');

export async function getJSON(url, { timeout = 30000, ttlMs = 86400000, cache = true, headers = {} } = {}) {
  // Headers are part of the cache key: the same URL can answer in two formats
  // depending on Accept, and caching one under the other's key serves garbage.
  const key = createHash('sha1').update(url + JSON.stringify(headers)).digest('hex') + '.json';
  const path = join(CACHE, key);
  if (cache && existsSync(path) && Date.now() - statSync(path).mtimeMs < ttlMs) {
    return { data: JSON.parse(readFileSync(path, 'utf8')), cached: true };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'BioRegional-OS/1.0 (+AGPL)', ...headers } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (cache) { mkdirSync(CACHE, { recursive: true }); writeFileSync(path, JSON.stringify(data)); }
    return { data, cached: false };
  } catch (err) {
    if (existsSync(path)) {
      return { data: JSON.parse(readFileSync(path, 'utf8')), cached: true, stale: true, error: err.message };
    }
    throw err;
  } finally { clearTimeout(t); }
}

/**
 * Same contract as getJSON, for upstreams that answer in text.
 * USGS statistics come back as RDB (tab-delimited with comment lines), which is
 * the only way to get day-of-year medians — and medians are what turn a gage
 * reading into a sentence worth reading.
 */
export async function getText(url, { timeout = 30000, ttlMs = 86400000, cache = true } = {}) {
  const key = createHash('sha1').update(url).digest('hex') + '.txt';
  const path = join(CACHE, key);
  if (cache && existsSync(path) && Date.now() - statSync(path).mtimeMs < ttlMs) {
    return { data: readFileSync(path, 'utf8'), cached: true };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'BioRegional-OS/1.0 (+AGPL)' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.text();
    if (cache) { mkdirSync(CACHE, { recursive: true }); writeFileSync(path, data); }
    return { data, cached: false };
  } catch (err) {
    if (existsSync(path)) {
      return { data: readFileSync(path, 'utf8'), cached: true, stale: true, error: err.message };
    }
    throw err;
  } finally { clearTimeout(t); }
}

/**
 * POST with the same cache-and-survive-offline contract as getJSON.
 *
 * Exists for one upstream shape: USDA Soil Data Access answers only to POST with
 * a raw SQL query in the body, and it is the authoritative US soil survey, so
 * "it only speaks POST" is not a reason to go without soil.
 *
 * Two things it has to be careful about that getJSON does not:
 *   • the cache key must cover the body, or every query to one URL collides;
 *   • SDA reports errors as an OGC XML document, so a parser that assumes JSON
 *     throws on the error path and the real message is lost. Detect the XML and
 *     surface what it said.
 */
export async function postJSON(url, body, { timeout = 40000, ttlMs = 86400000, cache = true, contentType = 'application/json' } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const key = createHash('sha1').update(`POST ${url} ${payload}`).digest('hex') + '.json';
  const path = join(CACHE, key);
  if (cache && existsSync(path) && Date.now() - statSync(path).mtimeMs < ttlMs) {
    return { data: JSON.parse(readFileSync(path, 'utf8')), cached: true };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST', body: payload, signal: ac.signal,
      headers: { 'content-type': contentType, 'user-agent': 'BioRegional-OS/1.0 (+AGPL)' },
    });
    const text = await res.text();
    const xml = xmlError(text);
    if (xml) throw new Error(xml);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = JSON.parse(text);
    if (cache) { mkdirSync(CACHE, { recursive: true }); writeFileSync(path, JSON.stringify(data)); }
    return { data, cached: false };
  } catch (err) {
    if (existsSync(path)) {
      return { data: JSON.parse(readFileSync(path, 'utf8')), cached: true, stale: true, error: err.message };
    }
    throw err;
  } finally { clearTimeout(t); }
}

/** SDA returns HTTP 200 with an OGC ServiceExceptionReport when a query is wrong. */
function xmlError(text) {
  if (!text || text.trimStart()[0] !== '<') return null;
  const m = text.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/i);
  const raw = m ? m[1] : text.slice(0, 200);
  return `upstream rejected the query: ${raw.replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()}`;
}

export function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
    .join('&');
}
