#!/usr/bin/env node
// One command that gets a person from "I downloaded a folder" to "it's running".
// Safe to run again at any time — it only does what still needs doing.
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, title, ok, warn, bad, info, step, cmd, run, c, line } from './lib.mjs';

title('Setting up BioRegional OS');

// 1 — Node
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  bad(`This needs Node 22 or newer. You have ${process.versions.node}.`);
  info('Install the "LTS" version from https://nodejs.org — then run this again.');
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// 2 — the screen part
if (!existsSync(join(ROOT, 'app', 'node_modules'))) {
  console.log('\n  Installing the parts that draw the map. This takes a minute or two…\n');
  if (!run('npm', ['install', '--no-audit', '--no-fund'], { cwd: join(ROOT, 'app') })) {
    bad('Could not install the map parts.');
    info('Usually this means no internet. Connect and run  npm run setup  again.');
    process.exit(1);
  }
}
ok('Map and interface parts installed');

// 3 — the engine's own parts
if (!existsSync(join(ROOT, 'node_modules', '@anthropic-ai'))) {
  console.log('\n  Installing the engine parts…\n');
  run('npm', ['install', '--no-audit', '--no-fund']);
}
ok('Engine parts installed');

// 4 — build the interface
console.log('\n  Building the interface…\n');
if (!run('npm', ['run', 'build'], { cwd: join(ROOT, 'app') })) {
  bad('The interface did not build.');
  info('Run  npm run doctor  and it will tell you what to do.');
  process.exit(1);
}
ok('Interface built');

// 5 — a place to keep the answers
const env = join(ROOT, '.env');
if (!existsSync(env)) {
  writeFileSync(env,
`# BioRegional OS settings. This file stays on your computer.
#
# OPTIONAL — only needed if you want the built-in assistant to talk back inside
# the app. You do NOT need this to use the OS, and you do NOT need it if you
# drive the OS from Claude Code instead (see docs/CLAUDE_CODE.md).
#
# Get a key at https://console.anthropic.com  →  API keys
# Then remove the # below and paste it after the =
#
# ANTHROPIC_API_KEY=
`);
  ok('Created .env (settings file)');
} else {
  ok('Settings file already there');
}

// 6 — data
const dbFile = join(ROOT, 'data', 'commons.db');
if (!existsSync(dbFile)) {
  console.log('');
  run('node', ['core/seed.mjs']);
  ok('Started your commons with example data (Austin / Barton Creek)');
  info('It is clearly labelled as example data. Replace it whenever you like.');
} else {
  ok('Your commons data is already here');
}

console.log(`\n  ${c.dim}${line()}${c.reset}`);
step('1', 'Start it:');
cmd('npm run os -- --open');
step('2', 'Lost at any point:');
cmd('npm run help');
step('3', 'Let other people in (phones on the same wifi):');
cmd('npm run connect');
console.log('');
