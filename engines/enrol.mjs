// ── Letting a second person write ─────────────────────────────────────────
// Until now everyone using this OS was the steward: no accounts, and the only
// thing a phone on the wifi could do was bring a need through /join. That is a
// good floor and it is not a commons — a chapter where one person types and
// everyone else submits to them is a chapter that stops when that person is
// ill, and the governance research is unanimous that it does stop.
//
// So: device enrolment, which is deliberately NOT sign-in.
//
//   NO ACCOUNTS, NO PASSWORDS, NOTHING TO REMEMBER. The thing that is enrolled
//   is a device, not a person. A phone scans a code once and is thereafter
//   known; nobody types a credential, ever, and there is nothing to reset at
//   eleven at night before a gathering.
//
//   THE CODE IS A HANDSHAKE, NOT A KEY. CoMapeo's pattern: the code on screen
//   opens an invitation, and it is single-use and short-lived. It carries no
//   commons material itself — what it grants is the right to ASK to be enrolled,
//   which the steward already decided by showing it.
//
//   THE SECRET IS NEVER STORED. Both the enrolment code and the device token
//   are kept as HMACs. Somebody who copies commons.db gets no ability to enrol
//   a device or impersonate one, which matters because the database is a file
//   this project actively encourages people to back up and move.
//
//   REVOCATION IS A STATUS CHANGE, NEVER A DELETION. ODK's revoked App Users
//   still appear as the submitter of everything they filed; CoMapeo models
//   BLOCKED and LEFT as roles because replicated data cannot be recalled.
//   Deleting a device would orphan its work and erase who did it, which is the
//   opposite of honouring a withdrawal.
//
// And the boundary this shares with server/clearance.mjs is the important part.
// A query parameter saying `clearance=sacred` is a CLAIM, and that is why it
// was a vulnerability. A device token is a SECRET the holder was given by
// somebody standing in the room — possessing it is the proof. The difference is
// not cosmetic and the code keeps them apart: the token is compared against a
// stored hash in constant time, and it never travels in a URL where it would
// land in a log or a referrer.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, one, run, create } from '../core/db.mjs';

/** Codes are short-lived because they are read off a screen in a room. */
export const CODE_MINUTES = 20;

/**
 * The key the hashes are keyed with.
 *
 * Derived from the database's own path plus a per-commons salt row, so two
 * chapters never produce the same hash for the same token, and a token lifted
 * from one commons means nothing in another.
 */
function hmacKey() {
  let salt = one(`SELECT value FROM settings WHERE key='enrol_salt'`)?.value;
  if (!salt) {
    salt = randomBytes(32).toString('hex');
    run(`INSERT INTO settings (key, value) VALUES ('enrol_salt', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`, salt);
  }
  return salt;
}

const hash = (token) => createHmac('sha256', hmacKey()).update(String(token)).digest('hex');

/** Constant-time compare, so a wrong token cannot be found a character at a time. */
function sameHash(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * A code a person can read off a screen and type on a phone.
 *
 * Grouped and unambiguous: no O/0, no I/1/l. Somebody is reading this aloud
 * across a room, and a character that has to be spelled out is a character
 * that gets the enrolment abandoned.
 */
function readableCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = () => alphabet[randomBytes(1)[0] % alphabet.length];
  // ~29 bits of entropy, which is fine because it expires in twenty minutes,
  // is single-use, and only ever grants the right to ask.
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

/**
 * Open an invitation. Returns the code ONCE — it is never readable again.
 */
export function inviteDevice(chapterId, { role = 'member', created_by = null, minutes = CODE_MINUTES } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  if (!['member', 'coordinator'].includes(role)) {
    return { error: 'not_allowed_value', message: 'A device is enrolled as member or coordinator.' };
  }
  const code = readableCode();
  run(`INSERT INTO capabilities (token_hash, chapter_id, purpose, role, expires_at, uses_left, created_by)
       VALUES (?,?, 'enrol_device', ?, datetime('now', ?), 1, ?)`,
    hash(code), chapterId, role, `+${Number(minutes) || CODE_MINUTES} minutes`, created_by);
  return {
    code,
    role,
    expires_in_minutes: Number(minutes) || CODE_MINUTES,
    // Said every time, because a code shown once and not written down is a
    // support call, and a code written down somewhere permanent is a key.
    note: 'Shown once. It works for one device, for ' +
          `${Number(minutes) || CODE_MINUTES} minutes, and grants only the right to ask to join.`,
  };
}

/**
 * Redeem a code. Returns the device token ONCE.
 *
 * The label is required and comes from the person enrolling, because "Maya's
 * phone" is what makes a revocation list usable six months later and
 * "device-4" is not.
 */
export function enrolDevice(chapterId, { code, label, person_name = null } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  if (!String(code ?? '').trim() || !String(label ?? '').trim()) {
    return {
      error: 'code_and_label_required',
      message: 'Type the code from the steward\'s screen, and a name for this device — ' +
               '"Maya\'s phone". The name is what makes a revocation list readable later.',
    };
  }
  const normalised = String(code).trim().toUpperCase().replace(/\s+/g, '');
  const cap = one(
    `SELECT * FROM capabilities WHERE token_hash=? AND chapter_id=? AND purpose='enrol_device'`,
    hash(normalised), chapterId);

  // One refusal for every way a code can fail, deliberately. Distinguishing
  // "wrong code" from "expired code" to a caller who does not hold either tells
  // them which half of the guess was right.
  const bad = {
    error: 'code_not_valid',
    message: 'That code is not open. Codes last twenty minutes and work once — ask for another.',
  };
  if (!cap) return bad;
  if (cap.revoked_at || cap.uses_left < 1 || cap.redeemed_at) return bad;
  if (one(`SELECT datetime('now') > ? AS expired`, cap.expires_at)?.expired) return bad;

  const token = randomBytes(32).toString('base64url');
  const person = person_name?.trim()
    ? create('people', 'person', chapterId,
        { chapter_id: chapterId, display_name: person_name.trim() })
    : null;

  const device = create('devices', 'device', chapterId, {
    chapter_id: chapterId,
    label: String(label).trim(),
    person_id: person?.id ?? null,
    secret_hash: hash(token),
    role: cap.role,
    enrolled_by: cap.created_by ?? null,
  });
  run(`UPDATE capabilities SET uses_left=0, redeemed_at=datetime('now') WHERE token_hash=?`,
      cap.token_hash);

  return {
    token,
    device: { id: device.id, label: device.label, role: device.role },
    person: person ? { id: person.id, display_name: person.display_name } : null,
    note: 'Keep this token on the device. It is shown once and cannot be recovered — if the ' +
          'device is lost, the steward revokes it and issues a new code.',
  };
}

/**
 * Who this request is, if it carries a device token.
 *
 * Returns null for anything unrecognised, expired or revoked — never a reason,
 * because the caller is either a device that works or somebody guessing.
 */
export function deviceFor(token) {
  if (!token) return null;
  const h = hash(String(token).trim());
  // Compared against every live device rather than looked up by key, so the
  // comparison itself is constant time. The list is a handful of rows.
  for (const d of all(
    `SELECT * FROM devices WHERE revoked_at IS NULL AND role NOT IN ('blocked','left')`)) {
    if (sameHash(d.secret_hash, h)) return d;
  }
  return null;
}

/** Note that a device was seen, without making that a write on every read. */
export function touchDevice(deviceId) {
  try {
    run(`UPDATE devices SET last_seen=datetime('now')
          WHERE id=? AND (last_seen IS NULL OR last_seen < datetime('now','-1 hour'))`, deviceId);
  } catch { /* a read must never fail because a timestamp would not write */ }
}

/** Every device, including the revoked ones — which is the point of the list. */
export function devices(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };
  const rows = all(
    `SELECT d.*, p.display_name person FROM devices d
       LEFT JOIN people p ON p.id = d.person_id
      WHERE d.chapter_id=? ORDER BY d.enrolled_at DESC`, chapterId);
  const live = rows.filter((d) => !d.revoked_at && !['blocked', 'left'].includes(d.role));
  const open = all(
    `SELECT role, expires_at FROM capabilities
      WHERE chapter_id=? AND purpose='enrol_device' AND redeemed_at IS NULL
        AND revoked_at IS NULL AND uses_left > 0 AND datetime('now') <= expires_at`, chapterId);
  return {
    devices: rows.map((d) => ({
      id: d.id, label: d.label, person: d.person ?? null, role: d.role,
      enrolled_at: d.enrolled_at, last_seen: d.last_seen,
      revoked_at: d.revoked_at,
      active: !d.revoked_at && !['blocked', 'left'].includes(d.role),
    })),
    active: live.length,
    invitations_open: open.length,
    sentence: !rows.length
      ? 'No devices enrolled. Only this computer can write to the commons, which means the ' +
        'commons stops when this computer does.'
      : `${live.length} device${live.length === 1 ? '' : 's'} can write` +
        (rows.length > live.length ? `, ${rows.length - live.length} revoked and kept` : '') +
        (open.length ? `. ${open.length} invitation${open.length === 1 ? '' : 's'} open.` : '.'),
    note: 'Revoked devices stay listed. They are still the recorded author of everything they ' +
          'filed, and removing the row would orphan that work rather than undo it.',
  };
}

/** Stop a device writing, keeping everything it has already written. */
export function revokeDevice(deviceId, { reason = null } = {}) {
  const d = one('SELECT * FROM devices WHERE id=?', deviceId);
  if (!d) return { error: 'not_found' };
  run(`UPDATE devices SET role='blocked', revoked_at=datetime('now'),
         label = label || ?
        WHERE id=?`, reason ? ` — revoked: ${String(reason).trim()}` : ' — revoked', deviceId);
  return {
    ...one('SELECT id, label, role, revoked_at FROM devices WHERE id=?', deviceId),
    note: 'It can no longer write. It is still the author of what it filed, and it stays on the ' +
          'list — a device that vanished would take the record of who did the work with it.',
  };
}

/** What a device's role may read over the network. */
export const ROLE_CLEARANCE = Object.freeze({
  coordinator: 'council',
  member: 'members',
});
