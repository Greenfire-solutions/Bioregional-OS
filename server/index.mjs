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
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { db, ROOT } from '../core/db.mjs';
import { api } from './routes/api.mjs';

const argv = process.argv.slice(2);
const SHARE = argv.includes('--share');
const OPEN = argv.includes('--open');
const PORT = Number(process.env.PORT || 4180);
const HOST = SHARE ? '0.0.0.0' : '127.0.0.1';
const APP_DIST = join(ROOT, 'app', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      if (url.pathname === '/api/connect') {
        const ip = lanAddress();
        let qr = null;
        if (SHARE && ip) {
          try {
            const QRCode = (await import('qrcode')).default;
            qr = await QRCode.toDataURL(`http://${ip}:${PORT}`, { margin: 1, width: 240 });
          } catch { /* qrcode not installed — the link alone still works */ }
        }
        return send(res, 200, JSON.stringify({
          qr,
          local_url: `http://localhost:${PORT}`,
          lan_url: SHARE && ip ? `http://${ip}:${PORT}` : null,
          sharing: SHARE,
          project_path: ROOT,
          hint: SHARE
            ? 'Anyone on this wifi can open the wifi link. Close this window to stop sharing.'
            : 'Only this computer can reach the OS right now. Run it with --share to let phones on the same wifi in.',
        }, null, 2), 'application/json; charset=utf-8');
      }
      const out = await api(req, res, url);
      if (out === undefined) return;                   // route wrote its own response
      send(res, out.status ?? 200, JSON.stringify(out.body ?? out, null, 2), 'application/json; charset=utf-8');
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
});

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
server.listen(PORT, HOST, () => {
  const ip = lanAddress();
  const line = '─'.repeat(52);
  console.log(`\n  🌿  BioRegional OS is running\n  ${line}`);
  console.log(`  On this computer   http://localhost:${PORT}`);
  if (SHARE && ip) console.log(`  On this wifi       http://${ip}:${PORT}   ← phones & laptops`);
  else console.log(`  Share on wifi      npm run os -- --share`);
  console.log(`  Your data          ${join(ROOT, 'data', 'commons.db')}`);
  console.log(`  ${line}`);
  console.log(`  Lost? Run  npm run help   ·   Something broken?  npm run doctor`);
  console.log(`  Stop it with Control + C. Nothing leaves this machine.\n`);
  if (OPEN) execFile('open', [`http://localhost:${PORT}`], () => {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  BioRegional OS is already running on port ${PORT}.`);
    console.error(`  Open http://localhost:${PORT} — or run it on another port:  PORT=4190 npm run os\n`);
    process.exit(1);
  }
  throw err;
});
