import React, { useEffect, useState } from 'react';
import { HelpCircle, X, Share2, Copy, Check, ChevronRight } from 'lucide-react';

// Plain-language help, written for someone who has never used a tool like this.
const HELP = {
  place: {
    title: 'My Place',
    what: 'Whether this commons is actually functioning — not whether it looks busy.',
    do: [
      'Read the Minimum Viable Chapter Test. Red crosses are the real to-do list.',
      'Each failing line tells you exactly what would make it pass.',
      'The dashboard leads with what is unresolved, on purpose.',
    ],
  },
  atlas: {
    title: 'Atlas — the 3D map',
    what: 'The real ecological boundaries you live inside, and everything happening on them.',
    do: [
      'Drag to move. Right-click drag (or two fingers) to tilt and spin.',
      'Coloured shapes are ecoregions — real boundaries from the US EPA, not drawn by us.',
      'Gold dots are your places, green dots are hubs, coloured posts are signals.',
      'Terrain / Globe switches the view. Level III / IV changes how fine the boundaries are.',
    ],
  },
  signals: {
    title: 'Signals',
    what: 'What the land and the people are showing right now.',
    do: [
      'Anything you add starts unverified. Verifying is a human act, never automatic.',
      'The water readings at the bottom come straight from USGS gages and refresh themselves.',
      'Click the pin icon to find something on the map.',
    ],
  },
  quests: {
    title: 'Quests',
    what: 'Projects, and whether they are actually allowed to proceed.',
    do: [
      'Click "check consent & safety gates" on any project.',
      'A project cannot reach the build stage with an open gate. That is enforced in the code.',
      'A good idea never overrides missing consent or a missing maintenance owner.',
    ],
  },
  council: {
    title: 'Council',
    what: 'Decisions, who they affect, and when they get looked at again.',
    do: [
      'Every item carries a Land Seat report — what the place has to say about it.',
      'Red flags block a decision from being finalised.',
      'Anything irreversible needs a heavier decision method than ordinary consent.',
    ],
  },
  gatherings: { title: 'Gatherings', what: 'Meetings and events, and whether people were actually cared for.',
    do: ['The care score counts meals, transport, childcare and accessibility.',
         'Below 2 out of 4 gets flagged. Exhausted people is a failure mode, not a badge.'] },
  exchange: { title: 'Exchange & Care', what: 'Who did the work and whether value came back to them.',
    do: ['Paid, apprentice and work-trade entries must have acknowledged terms.',
         'If most hours are unpaid, the system says so plainly.'] },
  learn: { title: 'Learn', what: 'What this commons knows, written so another place can use it.',
    do: ['"May travel" means another chapter can receive it.', 'The doctrine card is the thinking the whole OS runs on.'] },
  federation: { title: 'Federation', what: 'Other groups doing this work near you.',
    do: ['The discover button searches the Murmurations network — a shared, open directory.',
         'Nothing about you is published unless you choose to publish a profile.'] },
};

export default function Guide({ tab }) {
  const [open, setOpen] = useState(false);
  const [conn, setConn] = useState(null);
  const [copied, setCopied] = useState(false);
  const h = HELP[tab] ?? HELP.atlas;

  useEffect(() => {
    if (open && !conn) fetch('/api/connect').then((r) => r.json()).then(setConn).catch(() => {});
  }, [open, conn]);

  function copy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-[var(--moss)]
                   px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-[#3D4E41]">
        <HelpCircle className="h-4 w-4" /> I'm lost
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-30 max-h-[80vh] w-[22rem] overflow-y-auto rounded-lg
                    border border-[var(--line)] bg-[var(--paper)] shadow-2xl">
      <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3">
        <HelpCircle className="h-4 w-4 text-[var(--moss)]" />
        <div className="text-sm font-medium">Where you are</div>
        <button onClick={() => setOpen(false)} className="ml-auto text-[var(--ink-3)] hover:text-[var(--ink)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{h.title}</div>
          <p className="mt-1 text-sm">{h.what}</p>
        </div>
        <ul className="space-y-1.5">
          {h.do.map((d) => (
            <li key={d} className="flex gap-2 text-xs text-[var(--ink-2)]">
              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--gold)]" />{d}
            </li>
          ))}
        </ul>

        <div className="border-t border-[var(--line-2)] pt-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <Share2 className="h-3 w-3" /> Let someone else in
          </div>
          {conn?.lan_url ? (
            <div className="mt-2">
              <p className="text-xs text-[var(--ink-2)]">
                Anyone on this wifi can open it. No app, no login.
              </p>
              <button onClick={() => copy(conn.lan_url)}
                className="mt-1.5 flex w-full items-center gap-2 rounded border border-[var(--line)]
                           bg-[var(--paper-2)] px-2 py-1.5 text-left font-mono text-xs hover:border-[var(--moss)]">
                <span className="flex-1 truncate">{conn.lan_url}</span>
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--moss)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {conn.qr && <img src={conn.qr} alt="QR code to open on a phone"
                className="mx-auto mt-2 h-36 w-36 rounded border border-[var(--line)]" />}
              <p className="mt-1 text-center text-[10px] text-[var(--ink-3)]">point a phone camera at this</p>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-[var(--ink-2)]">
              Right now only this computer can see it. To let phones on the same wifi in, stop the OS
              and start it with <code className="rounded bg-[var(--line-2)] px-1">npm run os -- --share</code>
            </p>
          )}
        </div>

        <div className="border-t border-[var(--line-2)] pt-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Still stuck</div>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            In the terminal window, type <code className="rounded bg-[var(--line-2)] px-1">npm run help</code> for
            everything, or <code className="rounded bg-[var(--line-2)] px-1">npm run doctor -- --fix</code> if
            something is actually broken. You cannot break it by trying.
          </p>
        </div>
      </div>
    </div>
  );
}
