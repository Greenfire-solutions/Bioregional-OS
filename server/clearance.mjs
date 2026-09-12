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

/** Everything, for the person at the keyboard. */
export const FULL = 'sacred';
/** What a network stranger may read. */
export const STRANGER = 'public';

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
  return isLoopback(req?.socket?.remoteAddress) ? FULL : STRANGER;
}
