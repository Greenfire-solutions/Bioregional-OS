#!/usr/bin/env node
// Every way to get into this commons, in one place, in plain language.
//   npm run connect
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { ROOT, title, ok, warn, info, step, cmd, c, line } from './lib.mjs';
// Counted from the registry, never typed. A number in prose here went stale the
// first time a tool was added, and a wrong count in the front door is the kind of
// small lie that makes a reader doubt the rest of the page.
import { TOOLS } from '../ai/tools.mjs';

const PORT = Number(process.env.PORT || 4180);
const lan = (() => {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) return ni.address;
  }
  return null;
})();

title('Ways to use this commons');
console.log(`  ${c.dim}Pick whichever fits. You can use more than one at the same time.${c.reset}`);

// ── 1. This computer ──────────────────────────────────────────────────────
step('1', `${c.bold}Just me, on this computer${c.reset}  — simplest, nothing to configure`);
cmd('npm run os -- --open');
info('Opens in your browser. Nothing leaves this machine.');

// ── 2. The room ───────────────────────────────────────────────────────────
step('2', `${c.bold}Other people in the room${c.reset}  — phones and laptops on the same wifi`);
cmd('npm run os -- --share');
if (lan) {
  const url = `http://${lan}:${PORT}`;
  info(`They open:  ${c.blue}${url}${c.reset}`);
  console.log('');
  const qr = await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });
  console.log(qr.split('\n').map((l) => '   ' + l).join('\n'));
  info('Point a phone camera at that square. No app needed, no login.');
} else {
  warn('Not on a network right now — connect to wifi and run this again to get the link.');
}

// ── 3. Claude Code ────────────────────────────────────────────────────────
step('3', `${c.bold}Run the whole thing by talking to Claude Code${c.reset}`);
info('Already wired up. In a terminal:');
cmd(`cd "${ROOT}"`);
cmd('claude');
info('Then just ask: "what is the state of the commons?"');
info(`Claude Code reads .mcp.json in this folder and gets all ${TOOLS.length} tools automatically.`);

// ── 4. Claude Desktop ─────────────────────────────────────────────────────
const desktopCfg = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
step('4', `${c.bold}Claude Desktop app${c.reset}  — chat with your commons outside the terminal`);
if (process.argv.includes('--install-desktop')) {
  let cfg = {};
  if (existsSync(desktopCfg)) { try { cfg = JSON.parse(readFileSync(desktopCfg, 'utf8')); } catch {} }
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers['bioregional-os'] = { command: 'node', args: [join(ROOT, 'mcp', 'server.mjs')] };
  mkdirSync(join(homedir(), 'Library', 'Application Support', 'Claude'), { recursive: true });
  writeFileSync(desktopCfg, JSON.stringify(cfg, null, 2));
  ok('Added to Claude Desktop. Quit and reopen Claude Desktop to finish.');
} else {
  info('Run this and it sets itself up:');
  cmd('npm run connect -- --install-desktop');
  info(`(edits ${desktopCfg.replace(homedir(), '~')})`);
}

// ── 5. Any other tool ─────────────────────────────────────────────────────
step('5', `${c.bold}Any other program${c.reset}  — spreadsheets, maps, other apps`);
info('The OS speaks plain open formats over its own address:');
cmd(`curl http://localhost:${PORT}/api/export/geojson      # for QGIS, Google Earth, any map tool`);
cmd(`curl http://localhost:${PORT}/api/export/valueflows   # contributions, for hREA / Bonfire`);
cmd(`curl http://localhost:${PORT}/api/export/koi          # what knowledge exists, for other chapters`);
cmd(`curl http://localhost:${PORT}/api/status              # is it alive?`);

// ── 6. No computer at all ─────────────────────────────────────────────────
step('6', `${c.bold}Somebody with no computer${c.reset}`);
info('Print the Atlas and the council agenda, take them to the meeting, type the notes');
info('back in afterwards. The OS is designed to survive being offline — every reading');
info('it fetched is cached, and nothing needs the internet to open.');

// ── 7. Your own copy ──────────────────────────────────────────────────────
step('7', `${c.bold}Give a copy to another community${c.reset}`);
cmd('npm run update -- --package');
info('Makes a folder they can copy, with your protocol and none of your private data.');

console.log(`\n  ${c.dim}${line()}${c.reset}`);
console.log(`  ${c.dim}Stuck on any of these?  npm run help   ·   Something broken?  npm run doctor${c.reset}\n`);
