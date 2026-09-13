// ── Who is asking, and what they may therefore see ────────────────────────
// The sensitivity ladder — public / members / council / restricted / sacred —
// was enforced correctly everywhere EXCEPT at the point where the level was
// chosen. Three routes in api.mjs read it from the query string:
//
//     koi.manifest(chapterId, { clearance: q.clearance ?? 'public' })
//
// so `GET /api/export/koi?clearance=sacred` returned every restricted and
// sacred object, and `/api/export/koi/<rid>?clearance=sacred` returned the
// contents. The gate function was never wrong; it was simply asked to open by
// the person standing outside it. With `--share` binding 0.0.0.0 and the
// connect QR handing out `http://<lan-ip>:4180`, that was reachable by anyone
// on the gathering wifi.
//
// A clearance is a fact about the CONNECTION, never a field in the request.
// Nothing a client sends can raise it, because everything a client sends is
// under the client's control — which is the whole of the lesson.
//
// The line drawn here is the only one this system can actually defend without
// accounts: the machine the commons lives on is the steward's, and being sat
// at it is the credential. Everyone else is a stranger on a network, and a
// stranger gets what a stranger gets.

import { deviceFor, touchDevice, ROLE_CLEARANCE } from '../engines/enrol.mjs';

/** Everything, for the person at the keyboard. */
export const FULL = 'sacred';
/** What a network stranger may read. */
export const STRANGER = 'public';

/**
 * The ceiling for anything arriving over a network, whatever it presents.
 *
 * `restricted` and `sacred` are the two tiers a rights holder asked for, and
 * the connection carrying them here is plain HTTP on a shared wifi. An enrolled
 * device raises a stranger to a member or a coordinator; it does not turn a
 * gathering's wifi into a room where sacred material is read. If the council
 * needs that, they use the machine — which is a sentence somebody can act on,
 * unlike a promise about transport security this app cannot keep.
 */
export const NETWORK_CEILING = 'council';

export const LADDER = ['public', 'members', 'council', 'restricted', 'sacred'];
const lower = (a, b) => (LADDER.indexOf(a) <= LADDER.indexOf(b) ? a : b);

/**
 * Strip from an answer every object the connection may not see.
 *
 * The export routes already filter by clearance inside their adapters. Every
 * other answer — a tool result, a list route — was handed back whole, so a
 * member's device on the wifi calling `list_signals` received a sacred
 * observation alongside the public ones, and NETWORK_CEILING above was a
 * promise the tool route did not keep.
 *
 * This walks the answer once and removes any object whose id belongs to a RID
 * above the clearance, counting what it removed into `withheld` so protection
 * is visible rather than silent — the same rule the exports follow. Applied at
 * one place (server/routes/api.mjs) to everything that leaves over HTTP, so a
 * new tool or route is covered by default.
 *
 * At the keyboard it returns the answer untouched, and quickly.
 */
/**
 * withhold(), with the one definition of where hidden ids come from.
 *
 * The route built these deps inline, which was fine while the route was the
 * only caller. runTool has to withhold too — see the ordering note there — and
 * a second inline copy of this query is how two callers come to disagree about
 * what is hidden.
 */
export function protect(out, clearance, allRows, existingIds = null) {
  if (clearance === FULL || clearance == null) return out;
  return withhold(out, clearance, {
    hiddenIds: (levels) => {
      const hidden = new Set(
        allRows(`SELECT local_id FROM rids WHERE sensitivity IN (${levels.map(() => '?').join(',')})`, ...levels)
          .map((r) => r.local_id));
      // When the caller passes a snapshot of what existed beforehand, anything
      // minted during this call is not somebody else's record and is not
      // withheld from its own author. See runTool.
      if (!existingIds) return hidden;
      return new Set([...hidden].filter((id) => existingIds.has(id)));
    },
  });
}

export function withhold(out, clearance, deps) {
  if (clearance === FULL || out === undefined || out === null || typeof out !== 'object') return out;
  const above = LADDER.slice(LADDER.indexOf(clearance) + 1);
  if (!above.length) return out;
  const hidden = deps.hiddenIds(above);
  if (!hidden.size) return out;

  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      const kept = [];
      for (const x of v) {
        if (x && typeof x === 'object' && !Array.isArray(x) && hidden.has(x.id)) { n++; continue; }
        kept.push(walk(x));
      }
      return kept;
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (x && typeof x === 'object' && !Array.isArray(x) && hidden.has(x.id)) { n++; continue; }
        o[k] = walk(x);
      }
      return o;
    }
    return v;
  };

  // A single protected object asked for by id is refused outright rather than
  // returned hollow.
  if (!Array.isArray(out) && hidden.has(out.id)) {
    return { error: 'withheld', message: 'That is above what this connection may read.' };
  }
  const result = walk(out);
  if (n && !Array.isArray(result)) result.withheld = (result.withheld ?? 0) + n;
  return result;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/**
 * True when this address is the machine the OS is running on.
 *
 * Node reports IPv4 loopback over a dual-stack socket as `::ffff:127.0.0.1`,
 * so matching only '127.0.0.1' would silently demote the steward's own browser
 * to a stranger and make the Atlas look empty on their own laptop. The failure
 * would have been in the safe direction, which is exactly why it would have
 * been diagnosed as "the map is broken" and fixed by widening the wrong thing.
 */
export function isLoopback(address) {
  if (!address) return false;                 // no socket means no proof
  const a = String(address).trim().toLowerCase();
  if (LOOPBACK.has(a)) return true;
  // 127.0.0.0/8 is all loopback, not just .1 — and ::ffff:-mapped forms of it.
  return /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/**
 * The clearance a request has EARNED, from where it came from.
 *
 * Deliberately takes the request rather than an address, so that no caller can
 * accidentally pass something a client controls. There is no parameter here for
 * "the level they asked for", because there is no such thing.
 *
 * Proxy headers (`x-forwarded-for` and friends) are ignored on purpose. They
 * are set by whoever is in front, and nothing is in front of this — a local
 * server with no reverse proxy that trusts a forwarding header is a server that
 * lets a stranger claim to be the steward by typing a header name.
 */
export function clearanceFor(req) {
  if (isLoopback(req?.socket?.remoteAddress)) return FULL;

  // An enrolled device, and the distinction from the bug at the top of this
  // file matters. `?clearance=sacred` was a CLAIM — anybody could type it. A
  // device token is a SECRET somebody was handed in a room by a steward who
  // decided to hand it over, and holding it is the proof. That is the ordinary
  // difference between asserting a level and having been given one.
  //
  // It is read from a header rather than the query string because a URL ends up
  // in server logs, browser history and the Referer of every outbound link, and
  // a token in any of those is a token that has left the room it was given in.
  const token = req?.headers?.['x-bros-device'];
  if (!token) return STRANGER;
  const device = deviceFor(token);
  if (!device) return STRANGER;
  touchDevice(device.id);
  return lower(ROLE_CLEARANCE[device.role] ?? STRANGER, NETWORK_CEILING);
}

/** The device behind a request, for attributing what it writes. */
export function deviceOf(req) {
  if (isLoopback(req?.socket?.remoteAddress)) return null;
  const token = req?.headers?.['x-bros-device'];
  return token ? deviceFor(token) : null;
}
