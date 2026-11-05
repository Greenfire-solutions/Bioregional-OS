import React, { useEffect, useState } from 'react';
import { Globe2, ExternalLink } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The neighbours. §5.12.
 *
 * Other chapters, one line each, as this commons last read them. The entire
 * design is a set of refusals aimed at §3.6 — the Nextdoor failure mode, where
 * a list of what other people are doing becomes a feed and the feed becomes a
 * complaint engine.
 *
 * So: no refresh button, because a panel you can refresh is one you will.
 * No counter of unread anything. No reply, no reaction, nothing that travels
 * back. No ordering that rewards whoever posted most recently beyond a quiet
 * marker on what actually changed. And a line rather than a card, because the
 * point is peripheral awareness — you should be able to not read this.
 *
 * If a chapter is interesting, their link goes to their own site, which is
 * somebody else's commons rather than more of this app's content.
 */
export default function Neighbours() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    callTool('neighbours', { limit: 8 }).then((r) => live && !r?.error && setData(r)).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!data?.items?.length) return null;

  return (
    <section className="rounded border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          <Globe2 className="h-3 w-3" /> Elsewhere
        </span>
        <span className="text-[10px] text-[var(--ink-3)]">
{data.chapters > 0
            ? `${data.chapters} other bioregional ${data.chapters === 1 ? 'chapter' : 'chapters'} · nothing to answer`
            : 'others near here · nothing to answer'}
        </span>
      </div>

      <ul className="space-y-1.5">
        {data.items.map((n, i) => (
          <li key={i} className="text-[11px] leading-snug">
            <a href={n.url} target="_blank" rel="noreferrer noopener"
              className="font-medium text-[var(--ink)] hover:text-[var(--moss)]">
              {n.name}
              <ExternalLink className="ml-0.5 inline h-2.5 w-2.5 align-baseline text-[var(--ink-3)]" />
            </a>
            {n.where && <span className="text-[var(--ink-3)]"> · {n.where}</span>}
            {/* Only a peer whose own tags claim to be a bioregional commons is
                marked as one. Everything else the index returned is simply
                nearby, and saying so is the difference between belonging to a
                network and imagining one. */}
            {n.is_chapter && <span className="text-[var(--moss)]"> · chapter</span>}
            {/* The only thing here that is ever news, and it is a word, not a badge. */}
            {n.changed && <span className="text-[var(--ink-3)]"> · changed</span>}
            <span className="text-[var(--ink-2)]"> — {n.line}</span>
          </li>
        ))}
      </ul>

      {data.stale && (
        <p className="mt-2 text-[10px] text-[var(--ink-3)]">
          Last read {String(data.last_looked).slice(0, 10)}. These refresh while the OS is running.
        </p>
      )}
    </section>
  );
}
