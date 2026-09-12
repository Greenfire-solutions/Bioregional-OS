// Shared plumbing for the friendly command-line scripts.
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', gold: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[36m',
};
export const c = process.stdout.isTTY ? C : new Proxy({}, { get: () => '' });

export const line = (n = 54) => '─'.repeat(n);
export function title(t) { console.log(`\n  ${c.bold}${t}${c.reset}\n  ${c.dim}${line()}${c.reset}`); }
export function ok(m) { console.log(`  ${c.green}✓${c.reset} ${m}`); }
export function warn(m) { console.log(`  ${c.gold}!${c.reset} ${m}`); }
export function bad(m) { console.log(`  ${c.red}✗${c.reset} ${m}`); }
export function info(m) { console.log(`    ${c.dim}${m}${c.reset}`); }
export function step(n, m) { console.log(`\n  ${c.gold}${n}${c.reset}  ${m}`); }
export function cmd(m) { console.log(`      ${c.blue}${m}${c.reset}`); }

export function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
  return r.status === 0;
}

export function ask(question) {
  // Minimal synchronous prompt — no dependency, works in any terminal.
  process.stdout.write(question);
  try {
    const buf = Buffer.alloc(1024);
    const n = require('node:fs').readSync(0, buf, 0, 1024);
    return buf.toString('utf8', 0, n).trim();
  } catch { return ''; }
}
