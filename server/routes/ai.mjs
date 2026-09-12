// Streaming assistant endpoint. Manual agentic loop over the shared tool
// registry, streamed to the browser as SSE so the UI can show each tool call
// as it happens — the steward sees exactly which layers the AI touched.
import Anthropic from '@anthropic-ai/sdk';
import { one } from '../../core/db.mjs';
import { anthropicTools, runTool } from '../../ai/tools.mjs';
import { systemPrompt } from '../../ai/system.mjs';
import { readBody } from './api.mjs';

const MODEL = process.env.BROS_MODEL || 'claude-opus-5';
const MAX_TURNS = 12;

export async function aiStream(req, res) {
  const body = await readBody(req);
  const history = Array.isArray(body.messages) ? body.messages : [];
  const chapterId = body.chapter_id || one('SELECT id FROM chapters ORDER BY founded_at LIMIT 1')?.id;
  const chapter = chapterId ? one('SELECT * FROM chapters WHERE id=?', chapterId) : null;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    send('error', {
      message:
        'No ANTHROPIC_API_KEY set. Add it to .env in the project root, or drive the OS from ' +
        'Claude Code instead — the same tools are exposed over MCP (see docs/CLAUDE_CODE.md).',
    });
    return res.end();
  }

  const client = new Anthropic();
  const messages = [...history];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: systemPrompt(chapter),
        tools: anthropicTools(),
        messages,
      });

      stream.on('text', (delta) => send('text', { delta }));
      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        send('error', { message: 'The model declined this request.', details: message.stop_details ?? null });
        break;
      }

      messages.push({ role: 'assistant', content: message.content });

      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) { send('done', { stop_reason: message.stop_reason }); break; }

      const results = [];
      for (const tu of toolUses) {
        send('tool', { name: tu.name, input: tu.input });
        const out = await runTool(tu.name, tu.input);
        send('tool_result', { name: tu.name, summary: summarize(out) });
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 60000),
          is_error: !!out?.error,
        });
      }
      messages.push({ role: 'user', content: results });

      if (turn === MAX_TURNS - 1) send('error', { message: 'Reached the tool-call limit for one question.' });
    }
  } catch (err) {
    send('error', { message: err.message });
  }
  res.end();
}

/** A short, honest preview of a tool result for the activity rail. */
function summarize(out) {
  if (out == null) return 'no result';
  if (out.error) return `error: ${out.error}`;
  if (Array.isArray(out)) return `${out.length} record${out.length === 1 ? '' : 's'}`;
  if (out.type === 'FeatureCollection') return `${out.features?.length ?? 0} features`;
  if (typeof out === 'object') {
    const keys = Object.keys(out).slice(0, 5).join(', ');
    return keys || 'ok';
  }
  return String(out).slice(0, 120);
}
