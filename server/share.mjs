// ── Sharing on the wifi, as a decision a person makes in the app ──────────
//
// `--share` is a start-up flag, so turning it on meant quitting the OS, opening
// a terminal and typing a command — and if the commons holds anything above
// members-only, reading a refusal and typing a longer one. A chapter that
// installs by double-clicking the icon never passes any flags at all, so it was
// on 127.0.0.1 permanently and the Devices screen told the steward to go and
// use a terminal.
//
// That is the whole funnel. Every step before the first useful moment loses
// people, and "quit the app and use the command line" is not a step a
// non-technical steward takes: it is where they stop. Sharing is also the
// precondition for everything social in this project — the QR at a gathering,
// the join page, the field sheet's code — so a terminal in front of it puts a
// terminal in front of the second person, the third, and the whole reason a
// commons has more than one member.
//
// The loopback listener never moves. This opens a SECOND listener on 0.0.0.0
// with the same handler, and closes it again — so sharing is reversible in a
// click, nothing restarts, and the steward's own browser session survives it.
// A server that had to restart to be shared is a server nobody shares twice.
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { all } from '../core/db.mjs';

let listener = null;
let handler = null;
let boundPort = null;

/** The request handler the loopback server already uses. Set once, at boot. */
export function useHandler(fn, port) {
  handler = fn;
  boundPort = port;
}

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

/**
 * What this commons holds above members-only.
 *
 * ONE definition, used by the start-up flag and by the button. The CLI grew
 * this check first; a second copy in a tool handler is how two surfaces come to
 * disagree about what is safe to share, and this is not a rule that should be
 * written down twice.
 */
export function heldAboveMembers() {
  const rows = all(
    `SELECT sensitivity, object_type, COUNT(*) n FROM rids
      WHERE sensitivity IN ('restricted','sacred')
      GROUP BY sensitivity, object_type ORDER BY sensitivity DESC, n DESC`);
  return { total: rows.reduce((a, r) => a + r.n, 0), by_kind: rows };
}

export function sharingStatus() {
  const ip = lanAddress();
  return {
    sharing: !!listener,
    address: listener && ip ? `http://${ip}:${boundPort}` : null,
    join_url: listener && ip ? `http://${ip}:${boundPort}/join` : null,
    lan_available: !!ip,
    held_above_members: heldAboveMembers().total,
  };
}

/**
 * Turn it on.
 *
 * The consent gate is the same one the flag enforces and it REFUSES rather than
 * warns, for the same reason: a warning printed above a running server is a
 * warning nobody reads. `anyway` is that decision made knowingly, which is the
 * only version worth having — and in the app it can be made by somebody looking
 * at the list of what is held, which is more than the terminal ever offered.
 */
export function startSharing({ anyway = false } = {}) {
  if (listener) return { already: true, ...sharingStatus() };

  // The consent gate is asked FIRST, before any question about plumbing.
  //
  // It was second, behind "is there a server to share", and that is the wrong
  // order for a reason worth keeping: a protocol refusal masked by an internal
  // precondition teaches the caller the wrong thing. "There is no server" and
  // "the people these records belong to have not agreed" are not the same
  // answer, and only one of them is a decision somebody has to make.
  const held = heldAboveMembers();
  if (held.total && !anyway) {
    return {
      error: 'holds_protected_records',
      message: `This commons holds ${held.total} thing${held.total === 1 ? '' : 's'} above members-only. `
        + 'Devices on the wifi are only ever served public material and cannot ask for more — but '
        + 'sharing a commons that holds restricted or sacred records is a decision for the people '
        + 'those records belong to, not for whoever is at the keyboard.',
      held: held.by_kind,
      rule: 'Nothing over a network reaches restricted or sacred.',
      // Named, so the interface can offer the knowing version rather than
      // leaving a dead end the way the terminal refusal did.
      confirm_with: { tool: 'start_sharing', input: { anyway: true } },
    };
  }

  const ip = lanAddress();
  if (!ip) {
    return {
      error: 'no_network',
      message: 'This computer is not on a network anybody else could reach it over.',
    };
  }
  if (!handler) return { error: 'no_server', message: 'The OS is not running a server to share.' };

  return new Promise((resolve) => {
    const s = createServer(handler);
    // The error handler covers the BIND only, and is removed the moment the
    // socket is listening.
    //
    // Left attached, any later server-level error would set `listener = null`
    // while the socket stayed bound: sharingStatus() would report `sharing:
    // false`, the Devices screen would say "Only this computer can reach the
    // OS", and stopSharing() would return `{ already: true }` WITHOUT closing
    // anything. The door open and every surface saying it is shut is the worst
    // shape this could fail in, and it is the opposite of what the refusal
    // above is for.
    const onBindError = (err) => {
      listener = null;
      resolve({ error: 'could_not_share', message: err.message });
    };
    s.once('error', onBindError);
    s.listen(boundPort, '0.0.0.0', () => {
      s.removeListener('error', onBindError);
      // After binding, an error is a connection going wrong, not the door
      // failing to open. Swallowed deliberately: an unhandled 'error' on a
      // server takes the process down, and that would stop the commons.
      s.on('error', () => {});
      listener = s;
      resolve(sharingStatus());
    });
  });
}

/** Turn it off. Open connections are dropped; nothing on this machine changes. */
export function stopSharing() {
  if (!listener) return { sharing: false, already: true };
  const s = listener;
  listener = null;
  return new Promise((resolve) => {
    s.closeAllConnections?.();
    s.close(() => resolve(sharingStatus()));
  });
}
