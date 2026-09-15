// ── Is the running OS older than the code on disk? ────────────────────────
// Node reads every route and engine into memory once, at boot. So after an
// update — `npm run update`, a git pull, or somebody building a feature — the
// process that is still running is the OLD program, and no amount of reloading
// the browser changes that.
//
// The way this fails is the worst available: the interface is served from
// app/dist on disk, so it updates instantly and shows the new screens, while
// the routes behind them are the old ones and answer 404. The person sees a
// feature that looks present and does nothing, and the true sentence — "the
// thing serving this started before that code existed" — is not one anybody
// would guess.
//
// It cost a real afternoon twice in one day: a tab that was there but unreachable,
// and then a whole sign-in system whose routes did not exist in the process
// answering for them. The launcher hides it further, because clicking the icon
// when a server is already running just opens the browser at it.
//
// So the OS checks itself and says so.
import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../core/db.mjs';

/** When this process started. Fixed at import, which is what "running" means. */
export const STARTED_AT = Date.now();

// Everything whose contents are loaded into memory at boot and therefore
// CANNOT change without a restart. app/dist is deliberately absent: it is read
// from disk per request, so a rebuilt interface needs no restart and flagging
// it would cry wolf on the one change that is actually free.
const WATCHED = ['core', 'engines', 'adapters', 'server', 'ai', 'mcp'];

let cache = { at: 0, value: 0 };

/**
 * The newest modification time across the code this process is running.
 *
 * Cached for ten seconds. /api/status is called on every load and on every
 * refresh of the interface, and walking six directories on each one would be a
 * cost paid forever to answer a question whose answer changes about once a week.
 */
export function codeChangedAt() {
  const now = Date.now();
  if (now - cache.at < 10_000) return cache.value;
  let newest = 0;
  for (const dir of WATCHED) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    newest = Math.max(newest, newestIn(full, 0));
  }
  cache = { at: now, value: newest };
  return newest;
}

function newestIn(dir, depth) {
  if (depth > 3) return 0;                    // deep enough; nothing loaded lives below
  let newest = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    try {
      if (e.isDirectory()) newest = Math.max(newest, newestIn(full, depth + 1));
      else if (/\.(mjs|js|sql|json)$/.test(e.name)) newest = Math.max(newest, statSync(full).mtimeMs);
    } catch { /* vanished mid-walk; not worth failing a status call over */ }
  }
  return newest;
}

/**
 * Has the code changed since this process read it?
 *
 * A margin of five seconds, because a file written moments before the server
 * started is not a reason to tell somebody to restart it — that is simply how
 * `npm run setup && npm run os` looks from here.
 */
export function isStale() {
  const changed = codeChangedAt();
  return changed > 0 && changed > STARTED_AT + 5000;
}

/** The whole answer, for /api/status and for the launcher. */
export function staleness() {
  const changed = codeChangedAt();
  const stale = isStale();
  return {
    started_at: new Date(STARTED_AT).toISOString(),
    code_changed_at: changed ? new Date(changed).toISOString() : null,
    stale,
    message: stale
      ? 'This OS has been updated since it was started. What is running is the older version — ' +
        'the screens come from disk and update straight away, but the engine behind them does ' +
        'not. Stop it and start it again.'
      : null,
  };
}
