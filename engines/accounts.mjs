// ── Signing in ────────────────────────────────────────────────────────────
// A name and a password, for the people who sit down at a screen.
//
// This does NOT replace device enrolment and is not meant to. A phone at a
// creek should be enrolled with a code handed over in a room — the argument for
// that is in core/schema.sql and it has not changed. What device enrolment
// could not do is tell two coordinators apart: every override, every closed
// gate and every answered need was attributed to a free-text name somebody
// typed, which is attribution that cannot be wrong because it never claimed to
// be right.
//
// THE ONE RULE HERE: an account's role feeds the SAME clearance ladder an
// enrolled device feeds. There is no second permission system, no `requireRole`
// sitting beside `mayRun`, and no route that consults one and not the other.
// Two authorization systems is how a door comes to be closed in one of them and
// open in the other, which is this project's own most expensive bug shape.
import { createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { all, one, run, create } from '../core/db.mjs';
import { newId } from '../core/ids.mjs';

/** What an account's role may read. The device ladder, plus the steward. */
export const ACCOUNT_CLEARANCE = Object.freeze({
  steward: 'sacred',
  coordinator: 'council',
  member: 'members',
});

export const ROLES = Object.freeze(['steward', 'coordinator', 'member']);

/** A month. Long enough not to be a nuisance, short enough to expire. */
export const SESSION_DAYS = 30;

/**
 * The same salt the device tokens are keyed with, for the same reason: a
 * session token lifted from one commons must mean nothing in another, and
 * copying commons.db must not hand its reader a way to walk in as somebody.
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
const hashToken = (t) => createHmac('sha256', hmacKey()).update(String(t)).digest('hex');

/**
 * scrypt, from node's own crypto — no dependency, and deliberately slow.
 *
 * The parameters are stored WITH the hash rather than as constants in this
 * file. Raising the cost later is then a change that applies to new passwords
 * without invalidating every existing one, which is the difference between a
 * cost that can be raised and a cost that never is.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(String(password), salt, params.keylen,
    { N: params.N, r: params.r, p: params.p }).toString('hex');
  return `scrypt$${params.N}$${params.r}$${params.p}$${params.keylen}$${salt}$${key}`;
}

/** Constant time, so a wrong password cannot be found a character at a time. */
function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, keylen, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const got = scryptSync(String(password), salt, Number(keylen),
      { N: Number(N), r: Number(r), p: Number(p) });
    const want = Buffer.from(key, 'hex');
    if (got.length !== want.length) return false;
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

const normalise = (u) => String(u ?? '').trim().toLowerCase();

/**
 * How many passwords this refuses, and why it is not more.
 *
 * Long enough that it is not guessed; nothing else. No character classes, no
 * forced rotation — both are documented to push people towards `Spring2026!`
 * and a sticky note, and a commons whose steward keeps their password on the
 * monitor is worse off than one with a long plain passphrase.
 */
const MIN_PASSWORD = 10;

function checkPassword(password) {
  const p = String(password ?? '');
  if (p.length < MIN_PASSWORD) {
    return {
      error: 'password_too_short',
      message: `A password here is at least ${MIN_PASSWORD} characters. Four ordinary words is ` +
               'plenty and is easier to remember than anything with a punctuation mark in it.',
    };
  }
  return null;
}

/** Is there anybody at all yet? Decides whether this is the first-account case. */
export function anyAccounts(chapterId) {
  return (one('SELECT COUNT(*) n FROM accounts WHERE chapter_id=?', chapterId)?.n ?? 0) > 0;
}

/**
 * Make an account.
 *
 * NOT open registration, and that is the whole of the difference between this
 * and a website. A commons is a group of people who know each other; somebody
 * who can reach the port is not a member because they filled in a form. Who may
 * call this is decided in ai/access.mjs, where it sits at the keyboard and with
 * coordinators — exactly where inviting a device sits.
 *
 * The one exception is the FIRST account, which nobody can be invited to make
 * because there is nobody to do the inviting. That is allowed only from the
 * machine the commons lives on, and the caller proves that, not this.
 */
export function createAccount(chapterId, {
  username, password, display_name, role = 'member', person_id = null,
  created_by = null, must_change = false,
} = {}) {
  if (!chapterId) return { error: 'no_chapter', message: 'Found a chapter first.' };
  const u = normalise(username);
  if (!u) return { error: 'missing_required', message: 'An account needs a username.' };
  if (!/^[a-z0-9._-]{2,40}$/.test(u)) {
    return {
      error: 'bad_username',
      message: 'A username is 2–40 characters: letters, numbers, dot, dash or underscore.',
    };
  }
  const bad = checkPassword(password);
  if (bad) return bad;
  if (!ROLES.includes(role)) {
    return { error: 'unknown_role', message: `A role is one of: ${ROLES.join(', ')}.`, roles: ROLES };
  }
  if (one('SELECT id FROM accounts WHERE chapter_id=? AND username=?', chapterId, u)) {
    return { error: 'username_taken', message: `Somebody here already signs in as "${u}".` };
  }

  const name = String(display_name ?? '').trim() || u;
  const row = create('accounts', 'account', chapterId, {
    id: newId('acct'),
    chapter_id: chapterId,
    person_id,
    username: u,
    display_name: name,
    password_hash: hashPassword(password),
    role,
    created_by,
    must_change: must_change ? 1 : 0,
  }, 'council');
  return { ...publicAccount(row), created: true };
}

/** Never the hash, never in any answer, from anywhere. */
function publicAccount(a) {
  if (!a) return null;
  return {
    id: a.id, username: a.username, display_name: a.display_name, role: a.role,
    status: a.status ?? 'active', person_id: a.person_id ?? null,
    created_at: a.created_at, last_seen: a.last_seen ?? null,
    must_change: !!a.must_change,
    clearance: ACCOUNT_CLEARANCE[a.role] ?? 'members',
  };
}

export function listAccounts(chapterId) {
  return all('SELECT * FROM accounts WHERE chapter_id=? ORDER BY role, username', chapterId)
    .map(publicAccount);
}

/**
 * Sign in.
 *
 * One refusal for every way of failing, worded identically and costing the same
 * time. "No such user" and "wrong password" told apart is a way to enumerate
 * who is in a commons, and on a shared wifi that is the list of people in the
 * room.
 */
export function signIn(chapterId, { username, password, from_keyboard = false } = {}) {
  const refuse = () => ({
    error: 'sign_in_failed',
    message: 'That username and password do not match an account here.',
  });
  if (!chapterId) return refuse();
  const u = normalise(username);
  const a = one('SELECT * FROM accounts WHERE chapter_id=? AND username=?', chapterId, u);

  // The work is done either way. Returning early on an unknown username makes
  // the two cases measurably different lengths of time, which is the same leak
  // said more quietly.
  const ok = a ? verifyPassword(password, a.password_hash)
               : verifyPassword(password, hashPassword('never-matches-anything'));
  if (!a || !ok) return refuse();

  if (a.status !== 'active') {
    return {
      error: 'account_not_active',
      message: a.status === 'suspended'
        ? 'That account is suspended. A steward can lift it.'
        : 'That account has left this commons.',
    };
  }

  const token = randomBytes(32).toString('base64url');
  run(`INSERT INTO sessions (token_hash, account_id, expires_at, from_keyboard)
       VALUES (?, ?, datetime('now', ?), ?)`,
    hashToken(token), a.id, `+${SESSION_DAYS} days`, from_keyboard ? 1 : 0);
  run(`UPDATE accounts SET last_seen=datetime('now') WHERE id=?`, a.id);

  return { token, account: publicAccount(a), expires_in_days: SESSION_DAYS };
}

/** The account behind a session token, or null. Never throws on rubbish input. */
export function accountForSession(token) {
  if (!token) return null;
  const s = one(
    `SELECT s.*, a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL
        AND s.expires_at > datetime('now') AND a.status='active'`,
    hashToken(token));
  if (!s) return null;
  return publicAccount(s);
}

/** Last seen, updated cheaply — the same courtesy touchDevice does. */
export function touchSession(token) {
  if (!token) return;
  run(`UPDATE sessions SET last_seen=datetime('now') WHERE token_hash=?`, hashToken(token));
}

export function signOut(token) {
  if (!token) return { signed_out: false };
  const r = run(`UPDATE sessions SET revoked_at=datetime('now')
                  WHERE token_hash=? AND revoked_at IS NULL`, hashToken(token));
  return { signed_out: (r?.changes ?? 0) > 0 };
}

/** Every session for one account, ended. What a steward does after a laptop is lost. */
export function signOutEverywhere(accountId) {
  const r = run(`UPDATE sessions SET revoked_at=datetime('now')
                  WHERE account_id=? AND revoked_at IS NULL`, accountId);
  return { ended: r?.changes ?? 0 };
}

/**
 * Change a password.
 *
 * Changing your OWN needs the current one. Setting somebody ELSE's is a
 * different act — it is a steward helping a person who is locked out, it does
 * not need their old password, and it forces a change at next sign-in so the
 * steward does not keep a password that is not theirs. The caller says which
 * this is; ai/access.mjs says who may do the second.
 */
export function setPassword(accountId, { current = null, password, by_steward = false } = {}) {
  const a = one('SELECT * FROM accounts WHERE id=?', accountId);
  if (!a) return { error: 'not_found', message: 'No such account.' };
  const bad = checkPassword(password);
  if (bad) return bad;
  if (!by_steward) {
    if (!verifyPassword(current ?? '', a.password_hash)) {
      return { error: 'wrong_password', message: 'The current password does not match.' };
    }
  }
  run(`UPDATE accounts SET password_hash=?, must_change=? WHERE id=?`,
    hashPassword(password), by_steward ? 1 : 0, accountId);
  // Every other session for this account ends. A password change that leaves
  // the old sessions signed in has not changed anything for whoever was using
  // one, which is the case it exists for.
  const { ended } = signOutEverywhere(accountId);
  return {
    ...publicAccount(one('SELECT * FROM accounts WHERE id=?', accountId)),
    note: by_steward
      ? 'Set. They will be asked to choose their own at the next sign-in.'
      : 'Changed.',
    other_sessions_ended: ended,
  };
}

export function setRole(accountId, role) {
  if (!ROLES.includes(role)) {
    return { error: 'unknown_role', message: `A role is one of: ${ROLES.join(', ')}.`, roles: ROLES };
  }
  const a = one('SELECT * FROM accounts WHERE id=?', accountId);
  if (!a) return { error: 'not_found', message: 'No such account.' };
  // The last steward cannot demote themselves into a commons nobody can steward.
  if (a.role === 'steward' && role !== 'steward') {
    const others = one(
      `SELECT COUNT(*) n FROM accounts WHERE chapter_id=? AND role='steward' AND status='active' AND id<>?`,
      a.chapter_id, accountId)?.n ?? 0;
    if (!others) {
      return {
        error: 'last_steward',
        message: 'That is the only steward. Make somebody else a steward first — a commons with ' +
                 'nobody who can act for it is one laptop away from being nobody\'s.',
      };
    }
  }
  run('UPDATE accounts SET role=? WHERE id=?', role, accountId);
  return publicAccount(one('SELECT * FROM accounts WHERE id=?', accountId));
}

/**
 * Suspend or restore. There is no delete — the same rule as people, devices and
 * media: an account is the author of what it did.
 */
export function setStatus(accountId, status, { reason = null } = {}) {
  if (!['active', 'suspended', 'left'].includes(status)) {
    return { error: 'unknown_status', message: 'A status is active, suspended or left.' };
  }
  const a = one('SELECT * FROM accounts WHERE id=?', accountId);
  if (!a) return { error: 'not_found', message: 'No such account.' };
  if (a.role === 'steward' && status !== 'active') {
    const others = one(
      `SELECT COUNT(*) n FROM accounts WHERE chapter_id=? AND role='steward' AND status='active' AND id<>?`,
      a.chapter_id, accountId)?.n ?? 0;
    if (!others) {
      return { error: 'last_steward', message: 'That is the only active steward. Name another first.' };
    }
  }
  run('UPDATE accounts SET status=? WHERE id=?', status, accountId);
  const ended = status === 'active' ? { ended: 0 } : signOutEverywhere(accountId);
  return {
    ...publicAccount(one('SELECT * FROM accounts WHERE id=?', accountId)),
    sessions_ended: ended.ended,
    note: status === 'active'
      ? 'Active again. They will need to sign in.'
      : 'They can no longer sign in. They are still the author of everything they did, and the ' +
        'account stays on the list — an account that vanished would take that record with it.',
    reason: reason ? String(reason).trim() : null,
  };
}

/** Housekeeping: sessions that are over. Run by the heartbeat, cheap and silent. */
export function pruneSessions() {
  const r = run(`DELETE FROM sessions WHERE expires_at <= datetime('now', '-7 days')`);
  return { removed: r?.changes ?? 0 };
}
