import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crosshair, Loader2, MapPin, RefreshCw, TriangleAlert, ChevronDown, ChevronRight, Download, WifiOff,
} from 'lucide-react';
import { callTool } from '../api.js';
import { useHere, locate, lookUpTyped, forget } from '../here.js';
import { DossierSections } from './RegionPanel.jsx';

/**
 * Where the person holding this screen is standing, and everything the OS
 * knows about that ground.
 *
 * The board was only ever about the chapter: open the OS in Asheville and it
 * told you about Barton Creek, because that is where the commons is. Both are
 * true and they are different questions. This panel answers the other one: the
 * ecoregion and its parents, the watershed, the weather, the nearest gage, the
 * soil, what lives here, and the whole downloaded dossier for the ecoregion
 * and the bioregion it sits in.
 *
 * It holds no location of its own. The fix and the lookup live in here.js, so
 * this panel on the board, the same panel beside the map, and the map itself
 * all show one answer. `compact` is the version for a narrow column.
 */

function ago(at) {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
function bold(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-medium">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>);
}

export default function WhereYouAre({ onShowOnMap, compact = false, className = '' }) {
  const { fix, look, locating, reading, problem } = useHere();
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState('');
  const two = compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

  function submitTyped(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setTyping(false); setQuery('');
    lookUpTyped(q);
  }

  const eco = look?.ecoregion;
  const shed = look?.watershed;
  const where = look ? [look.place?.name, look.place?.detail].filter(Boolean).join(', ') : null;
  const busy = locating || reading;
  const alerts = look?.weather?.alerts ?? [];
  const rest = (look?.lines ?? []).filter((l, i) => !(i === 0 && l.kind === 'place') && !/^Biome: /.test(l.text));
  const headline = look?.lines?.[0]?.kind === 'place' ? look.lines[0].text : null;

  return (
    <section data-here className={`rounded border border-[var(--line)] bg-[var(--paper)] ${className}`}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--line)] px-4 py-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--gold)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-[var(--ink-3)]">Where you are right now</p>
          {where
            ? <h2 className="text-base font-medium leading-snug" data-here-place>{where}</h2>
            : <h2 className="text-base font-medium leading-snug">
                {locating ? 'Finding where you are…' : 'Not located yet'}
              </h2>}
          {fix && (
            <p className="mt-0.5 text-[11px] text-[var(--ink-3)]">
              {fix.typed ? 'A place you typed' : `From this device${fix.accuracy ? `, within about ${fix.accuracy >= 1000 ? `${Math.round(fix.accuracy / 100) / 10} km` : `${fix.accuracy} m`}` : ''}`}
              {' · '}{ago(fix.at)}
              {busy && <> · <Loader2 className="inline h-3 w-3 animate-spin align-[-2px]" /> {locating ? 'checking again' : 'reading the ground'}</>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button onClick={() => locate(false)} disabled={locating}
            className="flex items-center gap-1.5 rounded bg-[var(--moss)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : fix && !fix.typed ? <RefreshCw className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
            {fix && !fix.typed ? 'Check again' : 'Find me'}
          </button>
          <button onClick={() => setTyping((t) => !t)}
            className="rounded border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--ink-2)] hover:border-[var(--moss)]">
            Type a place
          </button>
          {look && onShowOnMap && (
            <button onClick={() => onShowOnMap({ lat: fix.lat, lng: fix.lng })}
              className="rounded border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--ink-2)] hover:border-[var(--moss)]">
              Show on the map
            </button>
          )}
        </div>
      </header>

      {typing && (
        <form onSubmit={submitTyped} className="flex gap-2 border-b border-[var(--line)] px-4 py-3">
          <label htmlFor="here-where" className="sr-only">A town, a creek, a road junction</label>
          <input id="here-where" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="A town, a creek, a road junction"
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--paper-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--ink-3)]" />
          <button type="submit" disabled={!query.trim()}
            className="rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Look</button>
        </form>
      )}

      {problem && (
        <p role="status" className="flex items-start gap-2 border-b border-[var(--line)] bg-[#FBF1EE] px-4 py-2.5 text-xs leading-snug">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clay)]" />
          <span>{problem}{look ? ' Showing the last place this browser knew.' : ''}</span>
        </p>
      )}

      {!look && !problem && !busy && (
        <p className="px-4 py-3 text-xs leading-relaxed text-[var(--ink-2)]">
          Press Find me and allow location when the browser asks. The OS will show the ecoregion,
          bioregion and watershed you are standing in, and everything it knows about them.
        </p>
      )}

      {look && (
        <>
          {alerts.length > 0 && (
            <ul className="border-b border-[var(--line)] bg-[#FBF1EE] px-4 py-2">
              {alerts.slice(0, 3).map((a, i) => (
                <li key={i} className="flex items-start gap-2 py-0.5 text-xs leading-snug text-[var(--clay)]">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><strong className="font-medium">{a.event}</strong>{a.headline ? `. ${a.headline}` : ''}</span>
                </li>
              ))}
            </ul>
          )}

          {headline && <p className="px-4 pt-3 text-[15px] leading-snug">{bold(headline)}</p>}

          {(eco || shed) ? (
            <dl className={`grid ${two} gap-x-6 gap-y-2 px-4 py-3`} data-here-nest>
              <Fact label="Ecoregion" value={eco?.ecoregion_name} note={eco?.ecoregion_code && `EPA Level IV · ${eco.ecoregion_code}`} />
              <Fact label="Bioregion" value={eco?.bioregion_name ?? eco?.level3_name} note={eco?.level3_code && `EPA Level III · ${eco.level3_code}`} />
              <Fact label="Division" value={eco?.level2_name} />
              <Fact label="Biome" value={eco?.biome} />
              <Fact label="Watershed" value={shed?.watershed_name} note={shed?.watershed_huc && `HUC ${shed.watershed_huc}`} />
              <Fact label="River basin" value={shed?.subbasin_name} note={shed?.subbasin_huc && `HUC ${shed.subbasin_huc}`} />
            </dl>
          ) : <div className="pt-1" />}

          <ul className="divide-y divide-[var(--line-2)] border-t border-[var(--line)] px-4">
            {rest.map((l, i) => (
              <li key={i} className={`flex gap-2.5 py-2 text-sm leading-snug ${
                l.kind === 'hazard' ? 'text-[var(--clay)]' : l.kind === 'gap' ? 'text-xs text-[var(--ink-3)]' : ''}`}>
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
                <span>{bold(l.text)}</span>
              </li>
            ))}
            {look.weather?.forecast?.detail && (
              <li className="flex gap-2.5 py-2 text-sm leading-snug">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
                <span>{look.weather.forecast.name}: {look.weather.forecast.detail}</span>
              </li>
            )}
            {look.depth !== 'full' && reading && (
              <li className="flex items-center gap-2 py-2 text-xs text-[var(--ink-3)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the river, the soil and what lives here…
              </li>
            )}
          </ul>

          {eco?.ecoregion_code && (
            <Dossier code={eco.ecoregion_code} scheme="epa-l4" open two={two}
              title={`Everything about the ${eco.ecoregion_name} ecoregion`} />
          )}
          {eco?.level3_code && (
            <Dossier code={eco.level3_code} scheme="epa-l3" two={two}
              title={`The wider ${eco.level3_name} bioregion`} />
          )}

          <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] px-4 py-2 text-[10px] leading-relaxed text-[var(--ink-3)]">
            <span className="min-w-0 flex-1">
              Looked up live from open public sources. Your location is kept in this browser only and
              nothing here is written to the commons.
            </span>
            <button onClick={forget} className="shrink-0 rounded border border-[var(--line)] px-2 py-0.5 hover:border-[var(--clay)]">
              Forget this location
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

function Fact({ label, value, note }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{label}</dt>
      <dd className="text-sm leading-snug">
        {value}
        {note && <span className="ml-1.5 text-[11px] text-[var(--ink-3)]">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * One region's whole dossier, read from disk, folded away until asked for.
 *
 * A region nobody has stood in before has no dossier yet. Fetching it is the
 * point of standing there, so it is fetched once without being asked, and if
 * that cannot happen (no connection, or this device may not write) the panel
 * says so and offers the button.
 */
function Dossier({ code, scheme, title, two, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const tried = useRef(null);

  const download = useCallback(async () => {
    setBusy(true); setFailed(null);
    const r = await callTool('download_region', { code, scheme }).catch(() => ({ error: 'unreachable' }));
    if (r?.error) setFailed(r.message || 'This region could not be downloaded just now.');
    else setBrief(await callTool('region_brief', { code, scheme }).catch(() => null));
    setBusy(false);
  }, [code, scheme]);

  useEffect(() => {
    let live = true;
    setBrief(null); setFailed(null);
    callTool('region_brief', { code, scheme }).then((r) => {
      if (!live) return;
      if (!r || r.error) { setFailed(r?.message || 'This region is not in the index.'); return; }
      setBrief(r);
      if (!r.downloaded && tried.current !== `${scheme}:${code}`) { tried.current = `${scheme}:${code}`; download(); }
    }).catch(() => live && setFailed('The library did not answer.'));
    return () => { live = false; };
  }, [code, scheme, download]);

  const has = brief?.downloaded;
  return (
    <div className="border-t border-[var(--line)]" data-here-dossier={`${scheme}:${code}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-[var(--paper-2)]">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1">{title}</span>
        {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ink-3)]" />}
      </button>
      {open && (
        <div className="pb-2">
          {!brief && !failed && <p className="px-4 py-2 text-xs text-[var(--ink-3)]">reading…</p>}
          {has && (
            <>
              <div className={`grid ${two} gap-x-6`}>
                <DossierSections brief={brief} className="px-4 py-2" />
              </div>
              <p className="px-4 pt-1 text-[10px] text-[var(--ink-3)]">
                Read from this computer's library, so it works with no connection.
                {brief.stale_sections?.length > 0 && ` Past its refresh date: ${brief.stale_sections.join(', ')}.`}
              </p>
            </>
          )}
          {brief && !has && (
            <div className="px-4 py-2">
              <p className="text-xs leading-snug text-[var(--ink-2)]">
                {busy ? 'Fetching what lives here, the soil, the water and the climate. This takes a minute, once.'
                  : 'What lives here, the soil, the water and the climate have not been downloaded for this region yet.'}
              </p>
              {!busy && (
                <button onClick={download}
                  className="mt-2 flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs font-medium text-white">
                  <Download className="h-3.5 w-3.5" /> Download this region
                </button>
              )}
            </div>
          )}
          {failed && (
            <p className="mx-4 mt-1 flex items-start gap-1.5 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-2 py-1.5 text-[11px] leading-snug">
              <WifiOff className="mt-0.5 h-3 w-3 shrink-0" /> {failed}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
