import React, { useEffect, useState } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { callTool, get } from '../api.js';
import { printOnly } from '../print.js';

/**
 * A sheet of paper you can take to the creek.
 *
 * Paper is a participation path, not a fallback. It is how somebody with no
 * smartphone, no signal in a field, or no interest in screens takes part, and
 * the inclusion literature is blunt that treating that as a concession is how
 * older people get designed out of things they would have joined.
 *
 * The one hard design rule comes from the hybrid-collection study in
 * docs/SOCIAL_LAYER.md §3.5: 99% of physical items in that project were
 * matchable because the identifying information was written ON THE ITEM, while
 * 24 arrived with no digital record at all and had to be rescued by hand. So
 * every sheet carries its own chapter, place, date and code. A sheet found in a
 * coat pocket three weeks later is still transcribable by somebody who was not
 * there — and a sheet handed back can never become an orphaned record.
 */
export default function FieldSheet() {
  const [ground, setGround] = useState(null);
  const [connect, setConnect] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      callTool('ground_today', {}).then((r) => (r?.error ? null : r)).catch(() => null),
      get('connect').catch(() => null),
    ]).then(([g, c]) => { setGround(g); setConnect(c); setBusy(false); });
  }, []);

  if (busy) {
    return <div className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
      <Loader2 className="h-4 w-4 animate-spin" /> preparing the sheet…
    </div>;
  }

  const today = new Date();
  const place = ground?.place?.name ?? 'the place';
  // From the NAME, not the id: the code is for a person matching paper to a
  // place, so it has to look like the place. An id gives you "0-0912".
  const code = sheetCode(place, today);
  // A printed sheet leaves the building. If the line at the top came from an
  // upstream that asks for credit, the paper carries it too.
  const credit = ground?.credit ?? null;
  // Paper carries none of the interface's context, so it says so itself.
  const isExample = /Barton Creek Greenbelt Reach/.test(place) && ground?.place?.id === 'plac_07850d2a';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 no-print">
        <div className="min-w-0">
          <h2 className="text-base font-medium">On paper</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            For the creek, for a gathering, and for anyone who would rather not use a screen.
            Everything needed to type it back in is printed on the sheet.
          </p>
        </div>
        <button onClick={() => printOnly('sheet')}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded border border-[var(--line)]
                     px-3 py-1.5 text-xs hover:border-[var(--moss)]">
          <Printer className="h-3.5 w-3.5" /> Print this sheet
        </button>
      </div>

      <div className="sheet rounded border border-[var(--line)] bg-white p-6 text-[var(--ink)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#999] pb-2">
          <div className="min-w-0">
            <div className="print-title text-base font-semibold">
              {ground?.place ? `Field sheet — ${place}` : 'Field sheet'}
            </div>
            <div className="print-meta mt-0.5 text-[11px] text-[var(--ink-2)]">
              {ground?.place?.watershed ? `${ground.place.watershed} watershed · ` : ''}
              {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm font-semibold tracking-wider">{code}</div>
            <div className="print-meta text-[10px] text-[var(--ink-2)]">write this on anything you bring back</div>
          </div>
        </div>

        {ground && (
          <p className="mt-2 text-[11px] italic text-[var(--ink-2)]">
            Today, before you went out: {ground.headline}
          </p>
        )}

        <p className="mt-3 text-[12px]">
          <strong>What did you notice?</strong> Water, a plant, an animal, a smell, a change,
          something wrong, something better. One line each. Your name against it, so people know
          who saw it.
        </p>

        <div className="mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="sheet-rule mb-1 flex items-end gap-3">
              <span className="pb-1 font-mono text-[10px] text-[var(--ink-3)]">{i + 1}</span>
              <span className="flex-1" />
              <span className="pb-1 text-[9px] text-[var(--ink-3)]">noticed by</span>
              <span className="w-28" />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-end justify-between gap-4 border-t border-[#999] pt-2">
          <p className="print-meta text-[10px] leading-snug text-[var(--ink-2)]">
            Hand this back to whoever is keeping the records, or type it in yourself
            {connect?.lan_url ? <> at <strong>{connect.lan_url}/join</strong></> : ' on the commons computer'}.
            Quote <strong>{code}</strong> so it lands in the right place and on the right date.
            <br />
            Nothing here goes on the internet.
            {isExample && <><br /><strong>Demonstration commons — the projects and people are fictional examples. The readings above are real public data.</strong></>}
            {credit && <><br /><span className="text-[9px]">{credit}</span></>}
          </p>
          {connect?.qr && (
            <img src={connect.qr} alt="Code to open the commons on a phone"
                 className="h-20 w-20 shrink-0" />
          )}
        </div>
      </div>

      {!connect?.lan_url && (
        <p className="text-[11px] text-[var(--ink-3)] no-print">
          Run <code className="rounded bg-[var(--paper-2)] px-1">npm run os -- --share</code> before
          printing and the sheet carries a link and a scannable code for phones on this wifi.
        </p>
      )}
    </div>
  );
}

/**
 * A short human code: place initials + date. Derived, never stored — it exists
 * so a person can match paper to a place and a day, and there is nothing to keep
 * in sync because it can always be recomputed from the two things on the sheet.
 */
function sheetCode(placeName, date) {
  const initials = String(placeName)
    .split(/[^A-Za-z]+/).filter(Boolean).slice(0, 3)
    .map((w) => w[0].toUpperCase()).join('') || 'BR';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${initials}-${mm}${dd}`;
}
