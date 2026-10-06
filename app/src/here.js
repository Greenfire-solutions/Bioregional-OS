import { useSyncExternalStore } from 'react';
import { callTool } from './api.js';

/**
 * Where the person holding this screen is standing. One answer, for every
 * screen that wants it.
 *
 * This lived inside the panel on the board for about an hour. The board knew
 * the person was in Asheville and the map, one tab over, opened on Austin,
 * because the answer was component state and the component was not mounted
 * there. A location is not a property of a panel. It is held here, once, and
 * the board, the map and the place column all read the same fix and the same
 * lookup, so they cannot disagree about where "here" is.
 *
 * How it stays fast and stays honest:
 *
 *   THE LAST ANSWER PAINTS FIRST. The previous fix and its lookup are kept in
 *   this browser, so nothing is empty while the device is thinking.
 *
 *   INSTANT, THEN FULL. `look_around` at depth "instant" is boundaries, sky
 *   and weather. "full" adds the gage, the soil and the species and takes
 *   seconds longer, so it arrives second.
 *
 *   A LAPTOP HAS NO GPS. It triangulates from wifi, and asking it for high
 *   accuracy regularly times out. So the ask is for ordinary accuracy with a
 *   generous timeout. An ecoregion is tens of kilometres across; a 300 metre
 *   fix is plenty.
 *
 *   EVERY WAY IT CAN FAIL SAYS WHICH ONE IT WAS. "Denied" covers a browser
 *   setting, a system setting and a dismissed prompt, and each has a different
 *   fix.
 *
 *   NOTHING IS WRITTEN TO THE COMMONS. `look_around` writes nothing. The fix
 *   lives in this browser's storage and can be forgotten with one click.
 */

const KEY = 'bros.here';
const REFRESH_AFTER_MS = 5 * 60 * 1000;      // re-ask the device when the tab comes back after this long
const MOVED_KM = 0.5;                        // under this, the old lookup still describes the ground

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function remember(v) {
  try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private window */ }
}
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dy = (b.lat - a.lat) * r, dx = (b.lng - a.lng) * r;
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const saved = remembered();
let state = {
  fix: saved?.fix ?? null,        // { lat, lng, accuracy, at, typed }
  look: saved?.look ?? null,      // the look_around answer for that fix
  locating: false,                // waiting on the device
  reading: false,                 // waiting on the lookup
  problem: null,                  // a sentence a person can act on
};
const listeners = new Set();
function set(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
let seq = 0;

/** Why the device would not say where it is, as something a person can act on. */
async function whyNot(err) {
  if (!window.isSecureContext) {
    return 'This page is not on a secure address, so the browser will not share a location here. Type a place instead.';
  }
  if (err?.code === 1) {
    let perm = null;
    try { perm = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* older browser */ }
    if (perm === 'denied') {
      return 'Location is blocked for this page. Click the icon at the left of the address bar, set Location to Allow, then press Find me.';
    }
    return 'The browser was not allowed to read a location. On a Mac, turn on Location Services for this browser in System Preferences, Security and Privacy, then press Find me.';
  }
  if (err?.code === 3) return 'This device took too long to work out where it is. Press Find me to try again, or type a place.';
  return 'This device could not work out where it is. Wifi needs to be on for a computer to locate itself. Press Find me to try again, or type a place.';
}

/** Look a point (or a typed name) up: the instant answer, then the full one. */
async function read(opts, nextFix) {
  const mine = ++seq;
  set({ reading: true });
  const first = await callTool('look_around', { depth: 'instant', ...opts }).catch(() => null);
  if (mine !== seq) return;
  if (!first || first.error) {
    set({ reading: false, problem: first?.message ?? 'The lookup did not answer. Is this computer online?' });
    return;
  }
  const fix = { ...nextFix, lat: first.place.lat, lng: first.place.lng, at: Date.now() };
  set({ fix, look: first, problem: null });
  remember({ fix, look: first });
  const full = await callTool('look_around', { depth: 'full', lat: fix.lat, lng: fix.lng }).catch(() => null);
  if (mine !== seq) return;
  if (full && !full.error) {
    // The typed name is the one the person chose; a reverse lookup of its
    // coordinates would rename it to whatever suburb is nearest.
    const look = opts.query ? { ...full, place: { ...full.place, name: first.place.name, detail: first.place.detail } } : full;
    set({ reading: false, look });
    remember({ fix, look });
  } else {
    set({ reading: false });
  }
}

/** Ask the device. `quiet` is the automatic ask on open: it never nags. */
export function locate(quiet = false) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    if (!quiet) set({ problem: 'This browser cannot share a location. Type a place instead.' });
    return;
  }
  if (state.locating) return;
  set({ locating: true });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here = {
        lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
        lng: Math.round(pos.coords.longitude * 1e4) / 1e4,
        accuracy: Math.round(pos.coords.accuracy),
        typed: false,
      };
      const was = state.fix;
      // Same ground, and the answer is recent and complete: keep it, note the new fix.
      if (was && !was.typed && state.look?.depth === 'full'
          && km(was, here) < MOVED_KM && Date.now() - was.at < 30 * 60 * 1000) {
        const fix = { ...was, accuracy: here.accuracy, at: Date.now() };
        set({ locating: false, fix, problem: null });
        remember({ fix, look: state.look });
        return;
      }
      set({ locating: false });
      read({ lat: here.lat, lng: here.lng }, here);
    },
    async (err) => {
      // With an answer already on screen, a quiet failure stays quiet.
      if (quiet && state.fix) { set({ locating: false }); return; }
      set({ locating: false, problem: await whyNot(err) });
    },
    { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
  );
}

/** A place the person typed. It stays until they ask for the device again. */
export function lookUpTyped(query) {
  const q = String(query ?? '').trim();
  if (q) read({ query: q }, { typed: true, accuracy: null });
}

export function forget() {
  seq++;
  remember(null);
  set({ fix: null, look: null, problem: null, reading: false });
}

/**
 * Start asking, once, for as long as the app is open: now, and again whenever
 * the tab comes back after a while. Called by App, not by a panel, so the map
 * knows where the person is even if they never open the board.
 */
let started = false;
export function startHere() {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (!state.fix?.typed) locate(true);
  document.addEventListener('visibilitychange', () => {
    const f = state.fix;
    if (document.visibilityState !== 'visible' || f?.typed) return;
    if (!f || Date.now() - f.at > REFRESH_AFTER_MS) locate(true);
  });
}

export function useHere() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}
