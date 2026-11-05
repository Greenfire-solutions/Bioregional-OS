// ── The three routes signing in needs ─────────────────────────────────────
// Sign in, sign out, and who am I.
//
// They are routes rather than tools on purpose. Everything else in this OS goes
// through the one tool registry, which is right — but a tool answers with JSON
// and these have to SET AND CLEAR A COOKIE, which is a thing only a route can
// do. Putting them in the registry would mean a tool that works over HTTP and
// silently does nothing over MCP.
import { one } from '../../core/db.mjs';
import * as accounts from '../../engines/accounts.mjs';
import { SESSION_COOKIE, cookies, isLoopback, clearanceFor } from '../clearance.mjs';
import { readBody } from './api.mjs';

/**
 * The cookie.
 *
 *   HttpOnly  — script on the page cannot read it, so a bug in the interface
 *               cannot hand somebody's session to anywhere else.
 *   SameSite=Lax — another site cannot make the browser act as this person.
 *   Path=/    — the whole app.
 *
 * NOT Secure, and that is not an oversight: this OS serves plain HTTP on
 * localhost and on a wifi address. `Secure` would mean the cookie is never
 * stored at all and sign-in would simply not work. The honest mitigation is the
 * warning the sign-in screen carries and the network ceiling that caps what any
 * connection over the wifi may reach, whoever they are.
 */
function cookieHeader(token, days) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${days * 24 * 60 * 60}`,
  ];
  return bits.join('; ');
}

const clearHeader = () =>
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/**
 * Who is asking, from the connection's point of view.
 *
 * `private` is what the sign-in screen warns about: over plain HTTP on a shared
 * network, everything typed is readable by anyone on it. Answered by the server
 * rather than guessed by the browser, because the browser cannot tell localhost
 * from a LAN address without being told.
 */
export function whoAmI(req) {
  const atKeyboard = isLoopback(req?.socket?.remoteAddress);
  const token = cookies(req)[SESSION_COOKIE];
  const account = token ? accounts.accountForSession(token) : null;
  const chapter = one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id ?? null;
  return {
    account,
    clearance: clearanceFor(req),
    at_keyboard: atKeyboard,
    private: atKeyboard,
    // Whether anybody has an account yet decides what the screen offers: a
    // commons with none needs its first steward made, and that can only happen
    // at the keyboard because there is nobody to do the inviting.
    any_accounts: chapter ? accounts.anyAccounts(chapter) : false,
    can_make_first: atKeyboard && chapter ? !accounts.anyAccounts(chapter) : false,
    warning: atKeyboard ? null
      : 'This connection is not private. Anyone on this wifi could read what you type.',
  };
}

export async function authRoute(req, res, url, { chapterId, clearance }) {
  const p = url.pathname.replace(/^\/api\/?/, '');

  if (p === 'me') return whoAmI(req);

  if (p === 'sign-in') {
    if (req.method !== 'POST') return { status: 405, body: { error: 'POST required' } };
    const body = await readBody(req);
    const atKeyboard = isLoopback(req?.socket?.remoteAddress);

    // The first steward. Nobody can be invited to make this account because
    // there is nobody to do the inviting, so it is the one account that makes
    // itself — at the keyboard, and only while there are none.
    if (body.first_steward) {
      if (!atKeyboard) {
        return { status: 403, body: {
          error: 'not_from_here',
          message: 'The first account is made at the computer the commons lives on.',
        } };
      }
      if (!chapterId) {
        return { status: 400, body: { error: 'no_chapter', message: 'Found a chapter first.' } };
      }
      if (accounts.anyAccounts(chapterId)) {
        return { status: 409, body: {
          error: 'already_set_up',
          message: 'This commons already has accounts. A steward can make another.',
        } };
      }
      const made = accounts.createAccount(chapterId, {
        username: body.username, password: body.password,
        display_name: body.display_name, role: 'steward',
        created_by: 'first run at the keyboard',
      });
      if (made.error) return { status: 400, body: made };
      // Straight in, rather than made and then asked to sign in with the
      // password they typed ten seconds ago.
    }

    const out = accounts.signIn(chapterId, {
      username: body.username, password: body.password, from_keyboard: atKeyboard,
    });
    if (out.error) {
      // 401 for a bad password, 403 for an account that exists and may not.
      return { status: out.error === 'sign_in_failed' ? 401 : 403, body: out };
    }
    res.setHeader('set-cookie', cookieHeader(out.token, out.expires_in_days));
    // The token is set as a cookie and NOT returned in the body. A token in a
    // JSON response is a token the page can read, store, and leak — the whole
    // point of HttpOnly is that nothing on the page ever holds it.
    return { account: out.account, signed_in: true, ...whoAmIAfter(req, out.account) };
  }

  if (p === 'sign-out') {
    if (req.method !== 'POST') return { status: 405, body: { error: 'POST required' } };
    const token = cookies(req)[SESSION_COOKIE];
    const out = accounts.signOut(token);
    res.setHeader('set-cookie', clearHeader());
    return { ...out, signed_out: true };
  }

  return undefined;                        // not an auth route
}

/** The shape /api/me returns, for the answer that follows a sign-in. */
function whoAmIAfter(req, account) {
  const atKeyboard = isLoopback(req?.socket?.remoteAddress);
  return {
    at_keyboard: atKeyboard,
    clearance: atKeyboard
      ? (accounts.ACCOUNT_CLEARANCE[account.role] ?? 'members')
      : undefined,
  };
}
