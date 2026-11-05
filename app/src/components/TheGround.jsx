import React, { useState, useEffect } from 'react';
import { Leaf, Droplets, Users, BookOpen, Sprout, ChevronRight, Loader2, Lock } from 'lucide-react';
import { Card, H, Pill } from '../views/Views.jsx';
import { callTool, get } from '../api.js';

// ── The ground here ───────────────────────────────────────────────────────
// Eleven Atlas layers were reachable by tool and invisible to a person. A page
// called "My Place" that said nothing about the place.
//
// Two rules shape this panel:
//
//   Facts the OS already holds render INSTANTLY and never fetch. Soil,
//   elevation, land cover and floodplain are resolved once by locate() and
//   stored on the place; asking the network again to show them would make the
//   page slow for no new information.
//
//   Everything else loads only when asked for. A person opening this page has
//   not consented to eight upstream requests, and a panel that fires them all
//   on mount is slow, rude to the services, and useless offline.
//
// Every section shows where its answer came from and under what licence,
// because a number with no provenance is the thing this whole OS refuses.

export default function TheGround({ place: given = null }) {
  // Fetches its own place rather than being handed one. That keeps this out of
  // App.jsx entirely, and the request is local — the place row already carries
  // soil, elevation, land cover and floodplain from locate().
  const [place, setPlace] = useState(given);
  // One local call. The registry is the only place a licence is declared, and
  // the stored soil/elevation/cover facts come off the place row rather than a
  // tool result, so they need it looked up rather than carried.
  const [registry, setRegistry] = useState({});
  useEffect(() => {
    callTool('upstream_sources', {}).then((r) => {
      const rows = (r?.result ?? r)?.sources ?? [];
      setRegistry(Object.fromEntries(rows.map((x) => [x.id, { name: x.name, license: x.license }])));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (given) { setPlace(given); return; }
    let alive = true;
    get('places').then((rows) => {
      if (!alive || !Array.isArray(rows)) return;
      // The same order anchorPlace uses on the server: a place the OS can
      // reason about beats a place it merely has coordinates for.
      const best = [...rows].filter((r) => r.lat != null).sort((a, b) =>
        (a.watershed_huc ? 0 : 1) - (b.watershed_huc ? 0 : 1) ||
        (a.soil_source ? 0 : 1) - (b.soil_source ? 0 : 1))[0];
      setPlace(best ?? null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [given]);

  if (!place) return null;
  const hasGround = place.soil_series || place.elevation_m != null || place.land_cover;

  return (
    <Card>
      <H sub={`What the open record says about ${place.name ?? "this ground"}. Resolved once and kept; the rest loads when you ask for it.`}>
        The ground here
      </H>

      {hasGround ? <Stored place={place} registry={registry} /> : (
        <p className="text-xs text-[var(--ink-2)]">
          This place has not been located against the open datasets yet. It happens by itself within
          six hours of the OS running, or ask the assistant to <code>soil_at</code>.
        </p>
      )}

      <div className="mt-4 space-y-2">
        <Section place={place} tool="water_here" icon={Droplets} label="Water: what is in it, and where it goes"
          render={(r) => <Water r={r} />} />
        <Section place={place} tool="life_here" icon={Leaf} label="What lives here"
          render={(r) => <Life r={r} />} />
        <Section place={place} tool="community_here" icon={Users} label="Care, food, skills and flows nearby"
          render={(r) => <Community r={r} />} />
        {/* no-print: the recordings are mostly CC-BY-NC and this project does
            not redistribute them. On screen they are links to their own host,
            which is fine. On paper they would be a copy. */}
        <Section place={place} tool="culture_here" icon={BookOpen} label="Memory: what was written, and what it sounds like"
          className="no-print" render={(r) => <Culture r={r} />} />
        <Section place={place} tool="growing_year" icon={Sprout} label="The growing year"
          render={(r) => <Growing r={r} />} />
      </div>
    </Card>
  );
}

// ── stored, instant ───────────────────────────────────────────────────────

function Stored({ place, registry }) {
  const soil = [
    place.soil_ph != null && `pH ${place.soil_ph}`,
    place.soil_organic_matter != null && `${place.soil_organic_matter}% organic matter`,
    place.soil_clay_pct != null && `${Math.round(place.soil_clay_pct)}% clay`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Fact label="Soil" value={place.soil_series ?? '—'}
        detail={[place.soil_map_unit, place.soil_drainage, soil].filter(Boolean).join(' · ')}
        note={place.soil_hydric ? 'Hydric — this is wetland soil, which is a permitting question before it is an ecological one.' : null} />
      <Fact label="Land cover" value={place.land_cover ?? '—'}
        detail={place.elevation_m != null ? `${Math.round(place.elevation_m)} m above sea level` : null} />
      <Fact label="Floodplain" value={place.flood_zone ? `FEMA zone ${place.flood_zone}` : '—'}
        detail={place.in_floodplain ? 'Inside the 1%-annual-chance floodplain' : place.flood_zone ? 'Outside the special flood hazard area' : null}
        note={place.flood_zone && !place.in_floodplain
          ? 'No mapped hazard is not the same as no flood risk — much flooding happens outside the regulatory map.' : null} />
      <div className="sm:col-span-3">
        <Src registry={registry}
          fallbackIds={[place.soil_source, 'usgs-3dep', 'mrlc-nlcd', 'fema-nfhl'].filter(Boolean)} />
      </div>
    </div>
  );
}

const Fact = ({ label, value, detail, note }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{label}</div>
    <div className="text-sm">{value}</div>
    {detail && <p className="mt-0.5 text-xs text-[var(--ink-2)]">{detail}</p>}
    {note && <p className="mt-1 text-[11px] text-[#8A6D1F]">{note}</p>}
  </div>
);

// ── lazy sections ─────────────────────────────────────────────────────────

function Section({ place, tool, icon: Icon, label, render, className = '' }) {
  const [state, setState] = useState('idle');  // idle | loading | done | error
  const [result, setResult] = useState(null);

  async function load() {
    setState('loading');
    try {
      const r = await callTool(tool, { place_id: place.id });
      const payload = r?.result ?? r;
      if (payload?.error) { setResult(payload); setState('error'); return; }
      setResult(payload); setState('done');
    } catch (err) {
      setResult({ message: err.message }); setState('error');
    }
  }

  return (
    <div className={`rounded border border-[var(--line)] ${className}`}>
      <button
        onClick={state === 'idle' || state === 'error' ? load : undefined}
        disabled={state === 'loading'}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--line-2)] disabled:opacity-60"
      >
        <Icon size={13} className="text-[var(--ink-3)]" />
        <span className="flex-1">{label}</span>
        {state === 'loading' ? <Loader2 size={13} className="animate-spin" />
          : state === 'idle' ? <span className="text-[10px] text-[var(--ink-3)]">look it up <ChevronRight size={10} className="inline" /></span>
          : null}
      </button>

      {state === 'error' && (
        <div className="border-t border-[var(--line)] px-3 py-2 text-xs text-[var(--clay)]">
          {result?.message ?? 'Could not reach it.'}{' '}
          <button onClick={load} className="underline">try again</button>
          <p className="mt-1 text-[11px] text-[var(--ink-3)]">
            Nothing is wrong with your commons — an upstream service did not answer. This is not an all-clear either.
          </p>
        </div>
      )}

      {state === 'done' && result && (
        <div className="border-t border-[var(--line)] px-3 py-2">{render(result)}</div>
      )}
    </div>
  );
}

const Lead = ({ children }) => <p className="text-xs text-[var(--ink-2)]">{children}</p>;

/**
 * Credit rendered from the registry, never retyped here.
 *
 * This component used to carry five hardcoded licence strings. The adapters
 * point at `source_id` and the registry declares the licence once — so a
 * retyped line meant the code could be right while the sentence on screen went
 * stale, and the sentence is the half somebody quotes.
 */
const Src = ({ attribution, fallbackIds, registry, children }) => {
  const rows = attribution?.length
    ? attribution
    : (fallbackIds ?? []).map((id) => registry?.[id]).filter(Boolean);
  if (!rows.length) return children ? <p className="mt-2 text-[10px] text-[var(--ink-3)]">{children}</p> : null;
  return (
    <p className="mt-2 text-[10px] text-[var(--ink-3)]">
      {rows.map((r, i) => (
        <span key={i}>{i > 0 && ' · '}{r.source ?? r.name}<span className="opacity-70"> ({r.license})</span></span>
      ))}
    </p>
  );
};
const Unavailable = ({ r }) => (
  <p className="text-[11px] text-[var(--ink-3)]">Not available — {r?.reason ?? 'no answer'}.</p>
);

// ── renderers ─────────────────────────────────────────────────────────────

function Water({ r }) {
  const n = r.network, q = r.quality;
  return (
    <div className="space-y-2">
      {n?.available ? <Lead>{n.readable}</Lead> : <Unavailable r={n} />}
      {q?.available && q.characteristics?.length > 0 && (
        <table className="w-full text-[11px]">
          <tbody>
            {q.characteristics.slice(0, 8).map((c, i) => (
              <tr key={i} className="border-t border-[var(--line-2)]">
                <td className="py-1 pr-2">{c.name}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{c.median ?? '—'}</td>
                <td className="py-1 pr-2 text-[var(--ink-3)]">{c.unit ?? ''}</td>
                <td className="py-1 text-right text-[var(--ink-3)]">
                  {c.samples}×
                  {/* Two units for one substance is the thing that must never be
                      silently averaged, so it is said out loud here too. */}
                  {c.also_reported_in && <span className="ml-1 text-[#8A6D1F]" title={`also reported in ${c.also_reported_in.join(', ')}`}>⚠ split units</span>}
                  {c.unit_looks_wrong && <span className="ml-1 text-[var(--clay)]" title="the portal recorded a time unit against a measurement">⚠ unit</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q?.characteristics?.some((c) => c.also_reported_in) && (
        <p className="text-[11px] text-[#8A6D1F]">
          Some measures arrive in more than one unit and are kept apart rather than averaged —
          a median across mg/L as N and as NO₃ is a number nobody measured.
        </p>
      )}
      <Src attribution={r.attribution} />
    </div>
  );
}

function Life({ r }) {
  return (
    <div className="space-y-2">
      <Lead>{r.readable}</Lead>
      {r.species?.top?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.species.top.slice(0, 12).map((t, i) => (
            <span key={i} className="rounded bg-[var(--line-2)] px-1.5 py-0.5 text-[10px]"
              title={t.name_is === 'scientific' ? 'no common name recorded' : t.scientific_name}>
              {t.name}{t.name_is === 'scientific' && <em className="opacity-60"> (sci.)</em>}
            </span>
          ))}
        </div>
      )}
      {r.threatened?.total_taxa > 0 && (
        <div className="rounded bg-[#FBF1EE] px-2 py-1.5">
          <div className="text-[11px] text-[var(--clay)]">
            <Lock size={11} className="mr-1 inline align-[-1px]" />
            {r.threatened.total_taxa} taxa carry a conservation status — held at{' '}
            <strong>{r.threatened.sensitivity}</strong>
          </div>
          <p className="mt-1 text-[10px] text-[var(--ink-2)]">{r.threatened.disclosure}</p>
        </div>
      )}
      {r.protection?.available && r.protection.protected && (
        <Lead>This ground sits inside {r.protection.unit ?? 'a protected area'}
          {r.protection.manager ? `, managed by ${r.protection.manager}` : ''}.</Lead>
      )}
      <Src attribution={r.attribution} />
    </div>
  );
}

function Community({ r }) {
  if (!r.available) return <Unavailable r={r} />;
  const layers = { 7: 'Getting about', 8: 'Care and essentials', 9: 'Skills and repair', 10: 'Food, energy, materials' };
  return (
    <div className="space-y-2">
      <Lead>{r.readable}</Lead>
      {[7, 8, 9, 10].map((n) => {
        const cats = r.categories.filter((c) => c.layer === n);
        if (!cats.length) return null;
        return (
          <div key={n}>
            <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{layers[n]}</div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {cats.map((c) => (
                <span key={c.key} className="rounded bg-[var(--line-2)] px-1.5 py-0.5 text-[10px]"
                  title={c.count_only ? 'counted, not mapped individually' : c.items.filter((i) => i.name).slice(0, 4).map((i) => i.name).join(', ')}>
                  {c.label} <strong className="tabular-nums">{c.count}</strong>
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--ink-3)]">{r.caveat}</p>
      <Src attribution={r.attribution} />
    </div>
  );
}

function Culture({ r }) {
  const s = r.sounds;
  return (
    <div className="space-y-2">
      <Lead>{r.readable}</Lead>
      {(r.papers?.widened_from || r.research?.widened_from) && (
        <p className="text-[11px] text-[#8A6D1F]">
          The archives were searched for a broader name than this place's own — results are about
          the wider water, not this reach specifically.
        </p>
      )}
      {r.papers?.pages?.length > 0 && (
        <ul className="space-y-0.5">
          {r.papers.pages.slice(0, 3).map((p, i) => (
            <li key={i} className="text-[11px]">
              <a href={p.url} target="_blank" rel="noreferrer" className="underline">{p.newspaper ?? p.title}</a>
              <span className="text-[var(--ink-3)]"> · {p.date}</span>
            </li>
          ))}
        </ul>
      )}
      {s?.available && s.recordings?.length > 0 && (
        <div className="rounded border border-[var(--line)] p-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">What it sounds like</div>
          <ul className="mt-1 space-y-1">
            {s.recordings.slice(0, 4).map((rec, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                {/* Linked at its own host, never copied. Most of these are
                    CC-BY-NC, which this project does not redistribute. */}
                <a href={rec.listen_url} target="_blank" rel="noreferrer" className="underline">{rec.species}</a>
                <span className="text-[var(--ink-3)]">{rec.observed_on}</span>
                <span className="text-[10px] text-[var(--ink-3)]">{rec.licence}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-[var(--ink-3)]">{s.export_note}</p>
        </div>
      )}
      <Src attribution={r.attribution}>Recordings each carry their own licence, shown per item above.</Src>
    </div>
  );
}

function Growing({ r }) {
  return (
    <div className="space-y-2">
      <Lead>{r.readable || 'Nothing available for this point.'}</Lead>
      {r.spring?.available && r.spring.anomaly_days != null && (
        <Pill tone={Math.abs(r.spring.anomaly_days) > 7 ? 'warn' : 'good'}>
          {r.spring.anomaly_days === 0 ? 'on time'
            : `${Math.abs(r.spring.anomaly_days)} days ${r.spring.anomaly_days < 0 ? 'early' : 'late'}`}
        </Pill>
      )}
      <Src attribution={r.attribution} />
    </div>
  );
}

// ── A baseline from public record ─────────────────────────────────────────
// The protocol says monitoring must change decisions. In practice it cannot,
// because a decision_trigger set against a guessed baseline will not honestly
// fire — and until now the only way to reach the open record was Claude Code.
// A person adding an indicator got a blank field and their best guess.
//
// This offers the number, with its source, its licence and its method, and
// refuses where nothing open measures the thing. It never fills the field
// silently: accepting is a click, because a baseline is a claim the commons
// will be held to.

export function BaselineOffer({ indicator, onApplied }) {
  const [state, setState] = useState('idle');
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState(null);

  async function propose() {
    setState('loading'); setError(null);
    try {
      const r = await callTool('propose_baseline', { indicator: indicator.name });
      const p = r?.result ?? r;
      if (!p?.proposed) { setProposal(p); setState('refused'); return; }
      setProposal(p); setState('offered');
    } catch (e) { setError(e.message); setState('error'); }
  }

  async function accept() {
    setState('applying');
    try {
      const r = await callTool('set_indicator_baseline', {
        indicator_id: indicator.id, value: proposal.baseline_value,
        unit: proposal.unit ?? undefined, method: proposal.method ?? undefined,
        source: proposal.source ?? undefined, licence: proposal.licence ?? undefined,
        measured_at: proposal.measured_at ?? undefined,
      });
      const res = r?.result ?? r;
      if (res?.error) { setError(res.message ?? res.error); setState('error'); return; }
      setState('done');
      onApplied?.();
    } catch (e) { setError(e.message); setState('error'); }
  }

  if (state === 'done') {
    return <p className="mt-2 text-[11px] text-[var(--moss)]">Baseline set from public record. It will show on the next refresh.</p>;
  }

  return (
    <div className="mt-2 rounded border border-dashed border-[var(--line)] px-2.5 py-2">
      {state === 'idle' && (
        <button onClick={propose} className="text-[11px] underline">
          No baseline — see whether the open record has one
        </button>
      )}
      {state === 'loading' && <span className="text-[11px] text-[var(--ink-3)]">Looking…</span>}

      {state === 'refused' && (
        <div className="text-[11px] text-[var(--ink-2)]">
          <p>{proposal?.message}</p>
          {/* Refusing is the point. A wrong baseline makes a decision look evidenced. */}
          <p className="mt-1 text-[var(--ink-3)]">{proposal?.guidance}</p>
        </div>
      )}

      {state === 'offered' && proposal && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm tabular-nums">{proposal.baseline_value}</span>
            <span className="text-[11px] text-[var(--ink-3)]">{proposal.unit}</span>
            <Pill tone="water">from public record</Pill>
          </div>
          <p className="text-[11px] text-[var(--ink-2)]">{proposal.method}</p>
          {proposal.note && <p className="text-[11px] text-[#8A6D1F]">{proposal.note}</p>}
          <p className="text-[10px] text-[var(--ink-3)]">
            {proposal.source}{proposal.licence ? ` — ${proposal.licence}` : ''} · measured {proposal.measured_at}
          </p>
          <p className="text-[10px] text-[var(--ink-3)]">{proposal.caveat}</p>
          <div className="flex gap-2 pt-0.5">
            <button onClick={accept} disabled={state === 'applying'}
              className="rounded bg-[var(--moss)] px-2 py-1 text-[11px] text-white disabled:opacity-60">
              {state === 'applying' ? 'Setting…' : 'Use this as the baseline'}
            </button>
            <button onClick={() => setState('idle')} className="text-[11px] underline text-[var(--ink-3)]">
              not this
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-[var(--clay)]">{error}</p>}
    </div>
  );
}
