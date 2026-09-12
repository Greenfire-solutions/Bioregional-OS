import React, { useEffect, useRef, useState } from 'react';
import {
  Send, Copy, Check, ImageDown, Printer, Loader2, RotateCw, Info,
} from 'lucide-react';
import { callTool } from '../api.js';
import FieldSheet from './FieldSheet.jsx';
import { printOnly } from '../print.js';

/**
 * The weekly card — the thing somebody pastes into the group chat.
 *
 * The OS sends nothing. This screen produces something a person copies and
 * posts, under their own name, at a moment they judge right. That is the whole
 * design: an undifferentiated group chat gets muted, and then the messages that
 * mattered are missed too.
 *
 * Text is the primary artefact. It survives being pasted, stays searchable in
 * the chat afterwards, and a screen reader can read it. The image is for a
 * noticeboard or a chat that mangles plain text.
 */

// Matched to index.css by hand: canvas cannot read CSS custom properties.
const INK = '#2C2A29', INK2 = '#5C574F', PAPER = '#F7F5F0', LINE = '#E3DFD5';
const MOSS = '#4A5D4E', GOLD = '#D4AF37';
const STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export default function Card({ onClose }) {
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const previewRef = useRef(null);

  // The clipboard is unavailable on the LAN: a page is a secure context only
  // over HTTPS or on localhost, and private-network reachability does not count.
  // So on a phone at http://192.168.x.x this is false, and a Copy button that
  // looked fine would silently do nothing.
  const canCopy = typeof navigator !== 'undefined'
    && window.isSecureContext && !!navigator.clipboard;
  const canCopyImage = canCopy && typeof window.ClipboardItem !== 'undefined';

  async function load() {
    setBusy(true);
    const r = await callTool('card_for_the_week', {});
    setCard(r?.error ? null : r);
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => { if (card && previewRef.current) paint(previewRef.current, card, 1); }, [card]);

  function flash(msg) { setSaid(msg); setTimeout(() => setSaid(null), 3000); }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(card.text);
      flash('Copied. Paste it into the group.');
      callTool('mark_card_sent', {}).catch(() => {});
    } catch { flash('Could not copy — select the text below instead.'); }
  }

  async function copyImage() {
    try {
      // Safari loses user activation if the async work happens before the
      // ClipboardItem is constructed, so the blob promise goes inside it.
      const item = new window.ClipboardItem({
        'image/png': (async () => {
          const c = document.createElement('canvas');
          await paint(c, card, 2);
          return await new Promise((res) => c.toBlob(res, 'image/png'));
        })(),
      });
      await navigator.clipboard.write([item]);
      flash('Image copied.');
      callTool('mark_card_sent', {}).catch(() => {});
    } catch (e) { flash(`Could not copy the image (${e.message}). Try Download.`); }
  }

  async function download() {
    const c = document.createElement('canvas');
    await paint(c, card, 2);
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(card.chapter)}-${card.week_of.replace(/\s/g, '-').toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      flash('Saved.');
      callTool('mark_card_sent', {}).catch(() => {});
    }, 'image/png');
  }

  if (busy && !card) {
    return <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> writing this week's card…
    </div>;
  }
  if (!card) return <div className="p-6 text-sm text-[var(--ink-2)]">No chapter yet.</div>;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">This week's card</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            For the group chat you already use. Nothing is sent from here — you post it, in your
            own name, when it suits.
          </p>
        </div>
        <button onClick={load} disabled={busy}
          className="ml-auto shrink-0 rounded border border-[var(--line)] p-1.5 hover:border-[var(--moss)]"
          title="Rewrite it">
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        {canCopy ? (
          <button onClick={copyText}
            className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white">
            <Copy className="h-3.5 w-3.5" /> Copy the text
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--paper-2)] px-3 py-1.5 text-[11px] text-[var(--ink-2)]">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Copying needs a secure connection, which a wifi address is not. Select the text below.
          </span>
        )}
        {canCopyImage && (
          <button onClick={copyImage}
            className="flex items-center gap-1.5 rounded border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--moss)]">
            <Copy className="h-3.5 w-3.5" /> Copy as image
          </button>
        )}
        <button onClick={download}
          className="flex items-center gap-1.5 rounded border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--moss)]">
          <ImageDown className="h-3.5 w-3.5" /> Download image
        </button>
        <button onClick={() => printOnly('card')}
          className="flex items-center gap-1.5 rounded border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--moss)]">
          <Printer className="h-3.5 w-3.5" /> Print the card
        </button>
        {said && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--moss)]">
            <Check className="h-3.5 w-3.5" />{said}
          </span>
        )}
      </div>

      {/* The text is the artefact. Always selectable, always visible, and the
          only thing that works when the clipboard does not. */}
      <textarea
        id="card-text" readOnly value={card.text}
        data-role="copy-source"
        onFocus={(e) => e.target.select()}
        rows={Math.min(20, card.text.split('\n').length + 1)}
        className="no-print w-full resize-y rounded border border-[var(--line)] bg-[var(--paper)] p-3
                   font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--moss)]"
      />

      <div className="print-card print-target-card">
        <canvas ref={previewRef} className="w-full max-w-[540px] rounded border border-[var(--line)]" />
      </div>

      <div className="print-target-sheet border-t border-[var(--line)] pt-5">
        <FieldSheet />
      </div>

      <p className="text-[11px] text-[var(--ink-3)] no-print">
        <Send className="mr-1 inline h-3 w-3" />
        No photographs or recordings are attached. Nearly all the media this OS can reach is
        licensed NonCommercial, which this project does not redistribute.
      </p>
    </div>
  );
}

/**
 * Draw the card onto a canvas. Returns when the pixels are there.
 *
 * Four things here are load-bearing, and every one of them fails by producing a
 * plausible image rather than an error:
 *   • fonts must be ready, or canvas silently paints a fallback face;
 *   • the backing store is scaled and everything drawn in logical units, or it
 *     is soft on every Retina screen;
 *   • layout runs before the canvas is sized, because height depends on wrapping;
 *   • the caller exports with toBlob, never toDataURL.
 */
async function paint(canvas, card, scale = 1) {
  if (document.fonts?.ready) await document.fonts.ready;

  const W = 1080, PAD = 64;
  const ctx = canvas.getContext('2d');

  // ── layout pass: wrap everything before we know the height ──────────────
  const blocks = [];
  const measure = (text, font, maxW) => {
    ctx.font = font;
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };

  const inner = W - PAD * 2;
  blocks.push({ kind: 'title', lines: [card.chapter], font: `600 46px ${STACK}`, lh: 56, gap: 6 });
  blocks.push({ kind: 'date', lines: [card.week_of], font: `400 24px ${STACK}`, lh: 32, gap: 34 });

  for (const s of card.sections) {
    blocks.push({ kind: 'label', lines: [s.label.toUpperCase()], font: `600 18px ${STACK}`, lh: 26, gap: 10 });
    for (const l of s.lines) {
      blocks.push({ kind: 'body', lines: measure(l, `400 27px ${STACK}`, inner), font: `400 27px ${STACK}`, lh: 38, gap: 8 });
    }
    blocks[blocks.length - 1].gap = 30;
  }
  blocks.push({ kind: 'foot', lines: ['Written from our own records. Nothing here is on the internet.'],
                font: `400 19px ${STACK}`, lh: 26, gap: 0 });

  const H = PAD * 2 + blocks.reduce((h, b) => h + b.lines.length * b.lh + b.gap, 0);

  // ── size, then paint in logical units ───────────────────────────────────
  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.style.aspectRatio = `${W} / ${H}`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, W, 8);

  let y = PAD + 20;
  for (const b of blocks) {
    ctx.font = b.font;
    ctx.fillStyle = b.kind === 'title' ? INK
      : b.kind === 'label' ? MOSS
      : b.kind === 'date' || b.kind === 'foot' ? INK2 : INK;
    for (const line of b.lines) { ctx.fillText(line, PAD, y); y += b.lh; }
    if (b.kind === 'foot') { /* nothing after */ }
    y += b.gap;
  }

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  return canvas;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
