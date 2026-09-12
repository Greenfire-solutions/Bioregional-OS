import React, { useEffect, useState } from 'react';
import { X, Loader2, Download, Leaf, Mountain, Droplets, CloudSun, Pickaxe, ShieldAlert, WifiOff } from 'lucide-react';
import { callTool } from '../api.js';

/**
 * What is actually here, for a region somebody just pointed at.
 *
 * The ecoregion index ships with the repo — all 967 EPA Level IV and 85 Level
 * III — so every polygon on the map can always say its own name, division and
 * biome with no network at all. The DOSSIER behind it (life, soil, water,
 * climate, resources, hazards) is compiled per region and is not in the repo,
 * because all of them together are about 95 MB of other people's open data.
 *
 * So this panel has three states, and the middle one is the one that matters:
 *
 *   downloaded  — everything, read from disk, works with the wifi off
 *   not yet     — the region's identity, plus a button that fetches the rest
 *   offline     — the identity, and an honest statement that the rest needs a
 *                 connection once, ever
 *
 * The old behaviour was a fourth state nobody chose: hovering showed a name and
 * clicking did nothing, so the library existed and the map could not reach it.
 * A region you can hover but not open is a map of labels.
 */
export default function RegionPanel({ region, onClose }) {
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let live = true;
    setBrief(null); setFailed(null);
    if (!region?.code) return;
    callTool('region_brief', { code: region.code, scheme: region.scheme })
      .then((r) => live && setBrief(r)).catch(() => live && setFailed('unreachable'));
    return () => { live = false; };
  }, [region?.code, region?.scheme]);

  async function download() {
    setBusy(true); setFailed(null);
    const r = await callTool('download_region', { code: region.code, scheme: region.scheme });
    if (r?.error) {
      // The honest failure. Compiling a region reads live upstreams, so with no
      // connection this cannot work — and saying "try again" would be a lie.
      setFailed(r.message || r.error);
    } else {
      setBrief(await callTool('region_brief', { code: region.code, scheme: region.scheme }));
    }
    setBusy(false);
  }

  if (!region) return null;
  const id = brief?.identity ?? region;
  const has = brief?.downloaded;

  return (
    <aside className="flex h-full w-[19rem] shrink-0 flex-col overflow-y-auto border-l
                      border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-start gap-2 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            Ecoregion {String(region.code).toUpperCase()}
          </div>
          <h3 className="text-sm font-medium leading-snug">{id.name ?? region.name}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">
            {[id.division ?? region.division, id.biome ?? region.biome].filter(Boolean).join(' · ')}
          </p>
          {id.states?.length > 0 && (
            <p className="text-[11px] text-[var(--ink-3)]">{id.states.join(', ')}</p>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 hover:bg-[var(--paper-2)]" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!brief && !failed && (
        <div className="flex items-center gap-2 px-4 py-6 text-xs text-[var(--ink-2)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading…
        </div>
      )}

      {brief && !has && (
        <div className="px-4 py-3">
          <p className="text-xs leading-snug text-[var(--ink-2)]">
            This region’s name and place in the classification ship with the OS and are readable
            offline. What lives here, the soil, the water and the climate have not been
            downloaded yet.
          </p>
          <button onClick={download} disabled={busy}
            className="mt-3 flex items-center gap-1.5 rounded bg-[var(--moss)] px-3 py-1.5 text-xs
                       font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? 'Fetching…' : 'Download this region'}
          </button>
          <p className="mt-2 text-[10px] leading-snug text-[var(--ink-3)]">
            About 90 KB from open public sources. Once it is here it is readable forever with no
            connection.
          </p>
          {failed && (
            <p className="mt-2 flex items-start gap-1.5 rounded border border-[#E4C9C2] bg-[#FBF1EE] px-2 py-1.5
                          text-[11px] leading-snug">
              <WifiOff className="mt-0.5 h-3 w-3 shrink-0" />
              {failed}
            </p>
          )}
        </div>
      )}

      {has && (
        <div className="divide-y divide-[var(--line)]">
          {brief.offline && (
            <p className="px-4 py-1.5 text-[10px] text-[var(--ink-3)]">
              Read from disk. No connection was used.
            </p>
          )}
          {SECTIONS.map(({ key, label, Icon }) => {
            const sec = brief[key];
            if (!sec || (Array.isArray(sec) && !sec.length)) return null;
            return (
              <section key={key} className="px-4 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
                  <Icon className="h-3 w-3" /> {label}
                </div>
                <Lines value={sec} />
              </section>
            );
          })}
          {brief.stale_sections?.length > 0 && (
            <p className="px-4 py-2 text-[10px] text-[var(--ink-3)]">
              Past its refresh date: {brief.stale_sections.join(', ')}. It still reads; it is just older.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

const SECTIONS = [
  { key: 'life', label: 'What lives here', Icon: Leaf },
  { key: 'soil', label: 'Soil', Icon: Mountain },
  { key: 'water', label: 'Water', Icon: Droplets },
  { key: 'climate', label: 'Climate', Icon: CloudSun },
  { key: 'resources', label: 'Resources', Icon: Pickaxe },
  { key: 'hazards', label: 'Hazards', Icon: ShieldAlert },
];

/**
 * A nested value, as a person reads it rather than as JSON.
 *
 * A dossier section carries lists inside objects — signature plants, birds,
 * mammals — and stringifying those printed a truncated array literal complete
 * with brackets, quotes and a severed last word. The names ARE the content
 * here; the punctuation around them is an implementation detail leaking onto
 * the screen.
 */
function short(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const names = v.map((x) => (typeof x === 'object' && x
      ? (x.common_name ?? x.name ?? x.label ?? '')
      : String(x))).filter(Boolean);
    return names.slice(0, 4).join(', ') + (names.length > 4 ? `, and ${names.length - 4} more` : '');
  }
  if (typeof v === 'object') return short(Object.values(v));
  return String(v).slice(0, 120);
}

/**
 * A dossier section is composed by adapters and its shape is theirs, not this
 * component's. Rendering it generically means a new adapter appears here on the
 * day it is written rather than the day somebody remembers to add a case —
 * the same reason forms are generated from the tool schemas.
 */
function Lines({ value }) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return <p className="text-[11px] leading-snug text-[var(--ink-2)]">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-0.5">
        {value.slice(0, 8).map((v, i) => (
          <li key={i} className="text-[11px] leading-snug text-[var(--ink-2)]">
            {typeof v === 'object' && v
              ? (v.common_name ?? v.name ?? v.label ?? v.title ?? JSON.stringify(v).slice(0, 90))
              : String(v)}
            {v?.count != null && <span className="text-[var(--ink-3)]"> · {v.count}</span>}
          </li>
        ))}
        {value.length > 8 && (
          <li className="text-[10px] text-[var(--ink-3)]">and {value.length - 8} more</li>
        )}
      </ul>
    );
  }
  // An object: show its own summary sentence if it wrote one, else its fields.
  if (value.sentence || value.summary) {
    return <p className="text-[11px] leading-snug text-[var(--ink-2)]">{value.sentence ?? value.summary}</p>;
  }
  const entries = Object.entries(value)
    .filter(([k, v]) => v != null && v !== '' && !k.startsWith('_') &&
      !['sources', 'attribution', 'fetched_at', 'cadence_days'].includes(k));
  if (!entries.length) return null;
  return (
    <dl className="space-y-0.5">
      {entries.slice(0, 8).map(([k, v]) => (
        <div key={k} className="flex gap-1.5 text-[11px] leading-snug">
          <dt className="shrink-0 text-[var(--ink-3)]">{k.replace(/_/g, ' ')}</dt>
          <dd className="min-w-0 text-[var(--ink-2)]">{short(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
