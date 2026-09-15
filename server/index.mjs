#!/usr/bin/env node
// BioRegional OS — local server.
//
//   npm run os            → runs on this computer only (http://localhost:4180)
//   npm run os -- --share → also reachable by phones/laptops on the same wifi
//   npm run os -- --open  → opens the browser for you
//
// Everything stays on this machine. No account, no cloud, no telemetry.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { execFile } from 'node:child_process';
import { db, ROOT, openPath } from '../core/db.mjs';
import { useHandler, startSharing, sharingStatus, heldAboveMembers, lanAddress } from './share.mjs';
import { isLoopback } from './clearance.mjs';
import { syncSources } from '../adapters/registry.mjs';
import { api } from './routes/api.mjs';
import * as heartbeat from '../engines/heartbeat.mjs';
import { one } from '../core/db.mjs';

const argv = process.argv.slice(2);
const SHARE = argv.includes('--share');
const NO_BEAT = argv.includes('--no-heartbeat');
const OPEN = argv.includes('--open');
const PORT = Number(process.env.PORT || 4180);
// The loopback listener never moves. Sharing opens a SECOND listener on
// 0.0.0.0 (server/share.mjs), so it can be turned on and off from inside the
// app without a restart — which is the difference between a chapter that shares
// and one whose steward was told to quit the app and use a terminal.
const HOST = '127.0.0.1';

// ── Sharing is a decision about a room, so it is made out loud ────────────
// --share binds 0.0.0.0 and the connect QR hands out http://<lan-ip>:4180, so
// everyone on the gathering wifi can reach the OS. Requests from off this
// machine are held at `public` (see routes/clearance.mjs) and cannot ask for
// more, so nothing protected is served — but a steward about to project a QR
// code in a room should be told what is in the commons before they do it,
// rather than trusting that a gate they cannot see is holding.
//
// It refuses rather than warns, because a warning printed above a running
// server is a warning nobody reads. --share-anyway is the same decision made
// knowingly, which is the only version of it worth having.
if (SHARE) {
  // One definition of "what is held above members-only", shared with the button
  // in the app. Two copies of this rule is how two surfaces come to disagree
  // about what is safe to share.
  const { total: held, by_kind: byKind } = heldAboveMembers();
  if (held && !argv.includes('--share-anyway')) {
    console.log(`
  Not sharing on the wifi.

  This commons holds ${held} thing${held === 1 ? '' : 's'} above members-only:`);
    for (const r of byKind) console.log(`    ${String(r.n).padStart(4)}  ${r.sensitivity}  ${r.object_type}`);
    console.log(`
  Phones on the wifi are only ever served public material — they cannot ask
  for more. But sharing a commons that holds restricted or sacred records is
  a decision for the people those records belong to, not for whoever is at
  the keyboard.

  If they have said yes:   npm run os -- --share --share-anyway
  To share nothing:        npm run os
`);
    process.exit(2);
  }
}
const APP_DIST = join(ROOT, 'app', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

// lanAddress lives in server/share.mjs, with the rest of the network-reach
// question. Re-exported so existing importers are unaffected.
export { lanAddress };

// Named, so the wifi listener can be handed the same function rather than
// reaching into the server's event emitter for it.
const handle = async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      if (url.pathname === '/api/connect') {
        // Asked, not remembered. This reported the BOOT FLAG, which stopped
        // being the truth the moment sharing became something you can turn on
        // and off from the app: the QR and the address would have gone on
        // describing how the process started rather than what is open now.
        const now = sharingStatus();
        const ip = lanAddress();
        let qr = null;
        if (now.sharing && ip) {
          try {
            const QRCode = (await import('qrcode')).default;
            qr = await QRCode.toDataURL(`http://${ip}:${PORT}`, { margin: 1, width: 240 });
          } catch { /* qrcode not installed — the link alone still works */ }
        }
        // Answered BEFORE api(), so there is no clearanceFor() and no withhold()
        // over it — which means everything here is public by construction and
        // has to be chosen that way. Two things were not: the count of
        // restricted and sacred records, added in the same commit whose own
        // comment says "telling a stranger whether the wifi door is open is
        // telling them about a door"; and an absolute path under /Users.
        const atKeyboard = isLoopback(req.socket.remoteAddress);
        return send(res, 200, JSON.stringify({
          qr,
          local_url: `http://localhost:${PORT}`,
          lan_url: now.address,
          sharing: now.sharing,
          ...(atKeyboard ? {
            held_above_members: now.held_above_members,
            project_path: ROOT,
          } : {}),
          hint: now.sharing
            ? 'Anyone on this wifi can open the wifi link. Stop sharing from Together → Devices.'
            : 'Only this computer can reach the OS right now. Turn sharing on from Together → Devices.',
        }, null, 2), 'application/json; charset=utf-8');
      }
      const out = await api(req, res, url);
      if (out === undefined) return;                   // route wrote its own response
      // An envelope is `{ status: <number>, body }`. `out.status ?? 200` treated
      // any answer with a `status` field as one — and an intake row's status is
      // the word "received", so `writeHead('received')` threw and a neighbour
      // bringing a need through the join page got HTTP 500 while their words
      // were written to the database. Same collision as in routes/api.mjs; it
      // had to be fixed in both, and only a real socket showed the second one.
      const envelope = out && typeof out === 'object'
        && Number.isInteger(out.status) && 'body' in out;
      send(res, envelope ? out.status : 200,
        JSON.stringify(envelope ? out.body : out, null, 2), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), 'application/json; charset=utf-8');
    }
    return;
  }

  if (!existsSync(join(APP_DIST, 'index.html'))) {
    return send(res, 200, bootstrapPage(), 'text/html; charset=utf-8');
  }
  let p = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(APP_DIST, p);
  if (!file.startsWith(APP_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(APP_DIST, 'index.html');               // SPA fallback
  }
  send(res, 200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
};

const server = createServer(handle);

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(body);
}

function bootstrapPage() {
  return `<!doctype html><meta charset="utf-8"><title>BioRegional OS — one step left</title>
<style>body{font:16px/1.7 ui-sans-serif,system-ui;background:#F7F5F0;color:#2C2A29;max-width:36rem;margin:5rem auto;padding:0 1.5rem}
code{background:#EAE6DD;padding:.2em .45em;border-radius:4px;font-size:.9em}h1{font-weight:600;font-size:1.4rem}
a{color:#4A5D4E}.step{border-left:3px solid #D4AF37;padding-left:1rem;margin:1.5rem 0}</style>
<h1>Almost there</h1>
<p>The BioRegional OS engine is running, but the screen part hasn't been built yet.</p>
<div class="step"><b>Do this:</b> stop this (press <code>Control</code> + <code>C</code>), then run
<code>npm run setup</code>, then start it again.</div>
<p>Nothing is broken. Setup only needs to happen once.</p>
<p>You can still look at the raw data: <a href="/api/status">/api/status</a></p>`;
}

db();
// Which upstreams exist, their licences and their Atlas layers are known at
// build time and have nothing to do with whether anything has been fetched yet.
// Writing the declaration at boot means "what data can this OS reach?" has an
// answer on a brand-new commons, before any adapter has run — and it gives
// last_fetched_at a row to land on when one does.
syncSources();
// The handler the loopback server uses is the handler the wifi listener uses.
// Registered before listen so `--share` can open the second socket immediately,
// and so the button can open it later without knowing anything about routing.
useHandler(handle, PORT);

server.listen(PORT, HOST, async () => {
  const chapter = one('SELECT id, name FROM chapters ORDER BY founded_at LIMIT 1');
  const ip = lanAddress();
  if (SHARE) await startSharing({ anyway: true });
  const line = '─'.repeat(52);
  console.log(`\n  🌿  BioRegional OS is running\n  ${line}`);
  console.log(`  On this computer   http://localhost:${PORT}`);
  if (SHARE && ip) console.log(`  On this wifi       http://${ip}:${PORT}   ← other devices`);
  else console.log(`  Share on wifi      the button on Together → Devices, or --share`);
  // The file actually open, not the default one. These differ whenever BROS_DB
  // is set, and a banner that names the wrong database is the same class of
  // problem as a scheduler that lies about running.
  console.log(`  Your data          ${openPath()}`);
  console.log(`  ${line}`);
  console.log(`  Lost? Run  npm run help   ·   Something broken?  npm run doctor`);
  console.log(`  Stop it with Control + C. Nothing leaves this machine.\n`);
  if (chapter && !NO_BEAT) {
    heartbeat.start(chapter.id);
    console.log(`  Tending ${chapter.name} while this stays open — locating places, refreshing`);
    console.log(`  water readings, watching review dates. Stop with --no-heartbeat.\n`);
  }
  if (OPEN) execFile('open', [`http://localhost:${PORT}`], () => {});
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  BioRegional OS is already running on port ${PORT}.`);
    // Ask the one that IS running whether it is older than the code on disk.
    // Without this, the whole message is "it is already running" — which is
    // true, unhelpful, and exactly what somebody sees after an update when the
    // new screens are on their screen and the new routes are not in that
    // process. Best effort: if it cannot be asked, the old advice stands.
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(2000) });
      const s = await r.json();
      if (s?.stale) {
        console.error(`\n  AND IT IS OUT OF DATE. It started ${new Date(s.started_at).toLocaleString()},`);
        console.error(`  and the code was changed after that. What is running is the older version.`);
        console.error(`\n  Stop it and start it again:`);
        console.error(`     lsof -ti tcp:${PORT} | xargs kill`);
        console.error(`     npm run os -- --open\n`);
        process.exit(1);
      }
    } catch { /* could not ask it; the line below is still true */ }
    console.error(`  Open http://localhost:${PORT} — or run it on another port:  PORT=4190 npm run os\n`);
    process.exit(1);
  }
  throw err;
});
