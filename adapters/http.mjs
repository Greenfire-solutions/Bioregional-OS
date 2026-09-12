// Shared fetch with timeout + a small on-disk cache, so the OS stays usable offline.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../core/db.mjs';

const CACHE = join(ROOT, 'data', 'upstream', 'cache');

export async function getJSON(url, { timeout = 30000, ttlMs = 86400000, cache = true } = {}) {
  const key = createHash('sha1').update(url).digest('hex') + '.json';
  const path = join(CACHE, key);
  if (cache && existsSync(path) && Date.now() - statSync(path).mtimeMs < ttlMs) {
    return { data: JSON.parse(readFileSync(path, 'utf8')), cached: true };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'BioRegional-OS/1.0 (+AGPL)' } });
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

export function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
    .join('&');
}
