// ── Claude Code, inside the app ───────────────────────────────────────────
// The assistant panel driven by the Claude Code CLI rather than the Anthropic
// SDK. It runs on the steward's own subscription, needs no API key, and reaches
// the commons through the same MCP server Claude Code uses from a terminal —
// which means every action goes through runTool and meets the same protocol
// refusals a person does.
//
// ── TWO GUARDS, AND WHY EACH EXISTS ───────────────────────────────────────
//
// 1. LOOPBACK ONLY, ALWAYS. `--share` binds 0.0.0.0 so a phone at a gathering
//    can reach /join, and there is no authentication anywhere on this API. That
//    is a fine trade for a page where somebody writes down what they noticed.
//    It is not a fine trade for an endpoint that spawns a subprocess and spends
//    the steward's subscription: on shared wifi that is an open door with a
//    stranger's hand already on it. This route refuses anything that did not
//    come from this machine, and says so rather than 404ing.
//
// 2. THE TOOL CHECK IS AN ALLOWLIST, THOUGH THE FLAG IS A DENYLIST.
//    `--allowedTools` does NOT restrict — it ADDS. Passing
//    `--allowedTools "mcp__bioregional-os__*"` leaves Bash, Edit, Read and Write
//    fully available; verified by asking one to run `whoami`, which it did. Only
//    `--disallowedTools` removes them.
//
//    But a denylist fails OPEN: miss a tool and you have granted it. A new CLI
//    release shipping a new file tool would be silent, because everything keeps
//    working. So the flag denies, and then the init event's own tool list is
//    checked against an ALLOWLIST on every single run. Anything unrecognised
//    aborts the exchange and says what appeared.
import { spawn } from 'node:child_process';
import { ROOT } from '../../core/db.mjs';

/**
 * Approved to run without a prompt. Nothing here can act outside the commons.
 */
const GRANTED = [
  'mcp__bioregional-os__*',   // the commons, gated by the protocol itself
  // ToolSearch is required, not incidental: the commons tools arrive DEFERRED,
  // so without it the CLI can see 77 tools and call none of them.
  //
  // It also cannot be used to get around the denial, which was worth checking
  // rather than assuming — the last thing I assumed about these flags was
  // wrong. Asked to load Bash and run `whoami`, the same probe that exposed
  // that `--allowedTools` does not restrict, it got back:
  //
  //     ToolSearch select:Bash  →  No matching deferred tools found
  //
  // so --disallowedTools removes a tool from the deferred index too, not only
  // from the up-front list the guard below inspects. That matters, because the
  // guard reads the INIT event: a tool that could appear later, mid-run, would
  // never pass under it.
  'ToolSearch',
];

/**
 * Removed from the CLI outright. Necessary, and on its own not sufficient.
 *
 * Enumerated from what the init event actually reported rather than from memory:
 * the built-in surface is wider than the obvious four, and includes tools that
 * message other sessions, schedule work and reach the network.
 */
const DENIED = [
  // run code or touch the disk
  'Bash', 'BashOutput', 'KillShell', 'Edit', 'Write', 'Read', 'NotebookEdit', 'Glob', 'Grep',
  // reach the network
  'WebFetch', 'WebSearch',
  // start other work, or other agents
  'Task', 'Agent', 'Workflow', 'Skill', 'SlashCommand', 'TaskOutput', 'TaskStop',
  'EnterWorktree', 'ExitWorktree', 'DesignSync',
  // schedule things that outlive the request
  'CronCreate', 'CronDelete', 'CronList', 'Monitor', 'ScheduleWakeup', 'RemoteTrigger',
  // speak to anyone outside this exchange
  'SendMessage', 'ListAgents', 'PushNotification', 'ReportFindings',
];

/**
 * What this assistant is allowed to have, as patterns. Everything the init
 * event reports must match one of these or the run is refused.
 *
 * This is the guard that survives a CLI update. The denylist above can only
 * remove tools somebody thought of.
 */
const PERMITTED = [
  /^mcp__bioregional-os__/,   // the 77 commons tools — the whole point
  /^ToolSearch$/,             // finds tool schemas; reaches nothing by itself
  /^TodoWrite$/,              // scratchpad, in-memory, touches nothing
  /^ExitPlanMode$/,
];

const isPermitted = (name) => PERMITTED.some((p) => p.test(name));

/** Only this machine. Not "not the internet" — this machine. */
function fromThisMachine(req) {
  const a = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/**
 * Is the Claude Code CLI actually on this machine, and what version?
 *
 * Asked once and remembered, because the interface asks on every status poll
 * and spawning a process every few seconds to learn something that changes
 * about twice a month is a poor trade. A restart re-asks.
 *
 * This deliberately reports `available: false` rather than throwing when the
 * CLI is missing: not having Claude Code is an ordinary state of this app, not
 * an error. The commons works without it.
 */
let cliProbe = null;
export function claudeAvailable() {
  if (cliProbe) return cliProbe;
  cliProbe = new Promise((resolve) => {
    let out = '';
    const p = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (c) => { out += c; });
    p.on('error', () => resolve({ available: false, version: null }));
    p.on('close', (code) => resolve(
      code === 0
        ? { available: true, version: out.trim() || null }
        : { available: false, version: null },
    ));
  });
  return cliProbe;
}

export async function claudeStream(req, res, body) {
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!fromThisMachine(req)) {
    // Refused with a reason, not hidden. Somebody on the wifi who finds this
    // should learn why it will not answer, not wonder whether it is broken.
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      error: 'loopback_only',
      message:
        'The assistant answers only on the computer running the OS. It spends that person\'s ' +
        'Claude subscription and starts a process on their machine, and nothing here asks who ' +
        'you are — so it is not offered over wifi even when the rest of the OS is. ' +
        'Everything else on this page works normally.',
    }, null, 2));
  }

  const prompt = String(body?.prompt ?? '').trim();
  if (!prompt) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'no_prompt' }));
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    // Only THIS project's MCP server. Without these two flags the CLI loads the
    // user's global MCP config as well — on this machine that was 501 tools
    // including Gmail, Slack, Google Drive and QuickBooks. An assistant panel in
    // a commons app would have been able to read its steward's email. No
    // denylist would have caught that; the allowlist check below did.
    '--mcp-config', '.mcp.json',
    '--strict-mcp-config',
    // The two flags do opposite jobs and BOTH are needed. --disallowedTools
    // removes; --allowedTools approves. With only the first, every commons call
    // stopped at a permission prompt — and a headless run has nobody to answer
    // it, so the assistant reported the protocol had blocked it when in fact it
    // had never reached the protocol at all. A refusal that isn't the real
    // refusal is worse than an error: it teaches the steward a rule that
    // doesn't exist. Approving these is safe precisely because they are the
    // only route in — every one goes through runTool and meets the same Land
    // Seat, reviewer and consent gates a person meets.
    '--allowedTools', ...GRANTED,
    '--disallowedTools', ...DENIED,
  ];
  if (body?.resume) args.push('--resume', String(body.resume));

  const child = spawn('claude', args, {
    cwd: ROOT,                       // so .mcp.json is found
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '', stderr = '', aborted = false, sessionId = null;
  const abort = (reason, detail) => {
    if (aborted) return;
    aborted = true;
    send('error', { message: reason, detail });
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    res.end();
  };

  child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.stdout.on('data', (chunk) => {
    if (aborted) return;
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }

      if (m.type === 'system' && m.subtype === 'init') {
        sessionId = m.session_id ?? null;
        const unexpected = (m.tools ?? []).filter((t) => !isPermitted(t));
        if (unexpected.length) {
          // The guard that outlives the flag. Something is reachable that this
          // route never intended to hand over — refuse the whole exchange rather
          // than hope the model does not use it.
          return abort(
            'The assistant was given tools this OS does not allow it, so the request was refused.',
            { unexpected: unexpected.slice(0, 12), total: (m.tools ?? []).length });
        }
        const os = (m.tools ?? []).filter((t) => t.startsWith('mcp__bioregional-os__')).length;
        const mcp = (m.mcp_servers ?? []).find((s) => s.name === 'bioregional-os');
        send('ready', { commons_tools: os, mcp_status: mcp?.status ?? 'missing', session_id: sessionId });
        if (mcp?.status !== 'connected') {
          return abort('The commons tools are not connected, so the assistant would be answering from nothing.',
            { mcp_status: mcp?.status ?? 'missing' });
        }
      }

      if (m.type === 'assistant') {
        for (const c of m.message?.content ?? []) {
          if (c.type === 'text' && c.text) send('text', { text: c.text });
          if (c.type === 'tool_use') {
            send('tool', { name: String(c.name).replace('mcp__bioregional-os__', ''), input: c.input });
          }
        }
      }

      if (m.type === 'user') {
        const content = m.message?.content;
        for (const c of Array.isArray(content) ? content : []) {
          if (c.type === 'tool_result') {
            const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
            // A refusal is the most interesting thing this can return, so it is
            // marked rather than buried in a result blob.
            const refused = /"error"\s*:/.test(text ?? '');
            send('tool_result', { refused, preview: String(text ?? '').slice(0, 400) });
          }
        }
      }

      if (m.type === 'result') {
        send('done', {
          session_id: m.session_id ?? sessionId,
          turns: m.num_turns ?? null,
          // Reported as usage, never as a charge. On a subscription run this is
          // an API-equivalent valuation, not money leaving an account, and
          // labelling an estimate as a bill is a confident claim in the
          // direction that changes behaviour.
          usage_estimate_usd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : null,
          is_error: !!m.is_error,
        });
        res.end();
      }
    }
  });

  child.on('error', (err) => abort(
    err.code === 'ENOENT'
      ? 'Claude Code is not installed on this computer, so the assistant cannot run.'
      : `Could not start Claude Code (${err.message}).`,
    null));

  child.on('close', (code) => {
    if (aborted || res.writableEnded) return;
    if (code !== 0) abort(`Claude Code exited with code ${code}.`, stderr.slice(-300) || null);
    else res.end();
  });

  req.on('close', () => { try { child.kill('SIGTERM'); } catch { /* gone */ } });
}

export const __test = { isPermitted, PERMITTED, DENIED, GRANTED, fromThisMachine };
