#!/usr/bin/env node
// ── MCP server ────────────────────────────────────────────────────────────
// Exposes the whole BioRegional OS to Claude Code as tools, over stdio.
// Hand-rolled JSON-RPC 2.0 — zero dependencies, so this runs anywhere Node does.
//
// Registered via .mcp.json in the project root; Claude Code picks it up when
// you open this folder. Then: "what's the state of the commons?"
import { TOOLS, runTool } from '../ai/tools.mjs';
import { db, one } from '../core/db.mjs';

const PROTOCOL_VERSION = '2024-11-05';

db(); // ensure schema

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  // Notifications carry no id and expect no reply.
  if (id === undefined) return;

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'bioregional-os', version: '1.0.0' },
          instructions:
            'BioRegional OS — a local commons running the BioRegional Commons protocol. ' +
            'Start with chapter_status. The tools enforce the protocol: consent gates, ' +
            'Land Seat reports and work-terms acknowledgement cannot be bypassed, and ' +
            'AI may not decide legitimacy, rights, funding, care or cultural permission. ' +
            'After producing anything the chapter will publish or act on, call log_ai_use ' +
            'with a named human reviewer.',
        });

      case 'tools/list':
        return reply(id, {
          tools: TOOLS.map(({ name, description, input_schema }) => ({
            name, description, inputSchema: input_schema,
          })),
        });

      case 'tools/call': {
        const out = await runTool(params?.name, params?.arguments ?? {});
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2).slice(0, 200000) }],
          isError: !!out?.error,
        });
      }

      case 'ping': return reply(id, {});
      default:
        return replyError(id, -32601, `method not found: ${method}`);
    }
  } catch (err) {
    replyError(id, -32603, err.message);
  }
}

function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }
function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

process.on('uncaughtException', (e) => { process.stderr.write(`bioregional-os mcp: ${e.stack}\n`); });
