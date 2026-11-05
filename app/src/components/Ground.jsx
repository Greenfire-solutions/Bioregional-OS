import React, { useEffect, useRef, useState } from 'react';
import {
  Sunrise, Sunset, Moon, Droplets, CloudSun, TriangleAlert, History, Check, Loader2, Pencil, AudioLines,
} from 'lucide-react';
import { callTool } from '../api.js';

/**
 * The land today — the part of the screen that gives before anything is asked.
 *
 * Deliberately absent: any count of what *you* did, any streak, any badge.
 * The only number about a person here is the one they choose to write down.
 */
export default function Ground({ onNoticed }) {
  const [g, setG] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    callTool('ground_today', {})
      .then((r) => live && (r?.error ? setFailed(r) : setG(r)))
      .catch(() => live && setFailed({ message: 'Could not read the ground.' }));
    return () => { live = false; };
  }, []);

  if (failed) {
    return (
      <div className="rounded border border-[var(--line)] bg-[var(--paper-2)] p-4 text-xs text-[var(--ink-2)]">
        {failed.message ?? 'Could not read the ground.'}
      </div>
    );
  }
  if (!g) {
    return (
      <div className="flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--paper-2)] p-4 text-xs text-[var(--ink-3)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the land…
      </div>
    );
  }

  const alert = g.weather?.alerts?.[0];
  const w = g.water;
  const sky = g.sky;

  return (
    <div className="overflow-hidden rounded border border-[var(--line)] bg-[var(--paper-2)]">
      {/* headline */}
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            {g.place.name}
          </span>
          {g.place.watershed && (
            <span className="truncate text-[10px] text-[var(--ink-3)]">· {g.place.watershed} watershed</span>
          )}
        </div>
        <p className={`mt-1 text-[15px] leading-snug ${alert ? 'text-[var(--clay)]' : ''}`}>
          {alert && <TriangleAlert className="mr-1.5 inline h-4 w-4 -translate-y-px" />}
          {g.headline}
        </p>
        {alert?.headline && (
          <p className="mt-1 text-[11px] text-[var(--ink-2)]">{alert.headline}</p>
        )}
        {/* An unreachable hazard feed must read as unreachable. A blank where a
            warning would go is the one failure here that could hurt somebody. */}
        {g.weather?.available && !g.weather.alerts_available && g.weather.alerts_note && (
          <p className="mt-1 text-[11px] text-[var(--clay)]">
            <TriangleAlert className="mr-1 inline h-3 w-3 -translate-y-px" />
            {g.weather.alerts_note}
          </p>
        )}
      </div>

      {/* the three readings */}
      <div className="grid grid-cols-1 divide-y divide-[var(--line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Cell icon={Droplets} label="Water">
          {w ? (
            <>
              <Value>{w.current === 0 ? 'dry' : `${fmt(w.current)} ${(w.unit ?? '').replace('ft3/s', 'ft\u00B3/s')}`}</Value>
              <Sub>{w.site_name}</Sub>
              {w.standing && <Sub>{w.standing}</Sub>}
              {w.day_of_year_median > 0 && (
                <Sub>
                  median for today: {fmt(w.day_of_year_median)}
                  {w.years_of_record ? ` · ${w.years_of_record} yr record` : ''}
                </Sub>
              )}
              {w.stale && <Sub warn>last known reading — offline</Sub>}
            </>
          ) : (
            <Sub>No gage resolved yet. Add a place with coordinates and the water finds you.</Sub>
          )}
        </Cell>

        <Cell icon={CloudSun} label="Weather">
          {g.weather?.available ? (
            <>
              <Value>
                {g.weather.current?.temperature_f != null
                  ? `${Math.round(g.weather.current.temperature_f)}°F`
                  : g.weather.forecast?.temperature != null
                    ? `${g.weather.forecast.temperature}°${g.weather.forecast.unit}`
                    : '—'}
              </Value>
              <Sub>{g.weather.current?.summary ?? g.weather.forecast?.summary}</Sub>
              {g.weather.forecast && (
                <Sub>
                  {g.weather.forecast.name}: {g.weather.forecast.summary}
                  {g.weather.forecast.precipitation_chance != null
                    ? ` · ${g.weather.forecast.precipitation_chance}% precip`
                    : ''}
                </Sub>
              )}
              {g.weather.stale && <Sub warn>last known forecast — offline</Sub>}
            </>
          ) : (
            <Sub>{g.weather?.reason ?? 'No weather upstream here.'}</Sub>
          )}
        </Cell>

        <Cell icon={Moon} label="Sky">
          <Value>{sky.daylight}</Value>
          <Sub>{sky.daylight_change}</Sub>
          <Sub>
            <Sunrise className="mr-1 inline h-3 w-3 -translate-y-px text-[var(--gold)]" />
            {time(sky.sunrise)}
            <Sunset className="mx-1 ml-3 inline h-3 w-3 -translate-y-px text-[var(--clay)]" />
            {time(sky.sunset)}
          </Sub>
          <Sub>
            {sky.moon.phase} moon, {Math.round(sky.moon.illumination * 100)}% lit
            {sky.next_turn ? ` · ${sky.next_turn.name} in ${sky.next_turn.days_away}d` : ''}
          </Sub>
        </Cell>
      </div>

      {/* What this place sounds like. A fact only — the recordings are streamed
          from iNaturalist and never copied, because nearly all of them are
          NonCommercial and this project redistributes none of it. */}
      {g.heard?.fact && (
        <div className="flex items-start gap-2 border-t border-[var(--line)] px-4 py-2.5">
          <AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--water)]" />
          <p className="text-[11px] leading-snug text-[var(--ink-2)]">
            {g.heard.fact}
            {g.heard.species_count ? ` · ${g.heard.species_count} species heard here` : ''}
          </p>
        </div>
      )}

      <Notice place={g.place} onSaved={onNoticed} />

      {g.history?.items?.length > 0 && (
        <div className="border-t border-[var(--line)] px-4 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            <History className="h-3 w-3" /> This week in earlier years
          </div>
          <ul className="space-y-1">
            {g.history.items.slice(0, 4).map((it, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-[var(--ink-2)]">
                <span className="w-16 shrink-0 tabular-nums text-[var(--ink-3)]">{year(it.at)}</span>
                <span className="truncate">{it.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One question. The whole daily contribution, and it is optional. */
function Notice({ place, onSaved }) {
  const [text, setText] = useState('');
  const [state, setState] = useState('idle');
  const ref = useRef(null);

  async function save(e) {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    setState('saving');
    const r = await callTool('add_signal', {
      title,
      place_id: place.id ?? undefined,
      lat: place.lat, lng: place.lng,
      location_name: place.name,
      category: 'Ecological',
      severity: 'Info',
      source: 'notice',
    });
    if (r?.error) { setState(r.message || r.error); return; }
    setText(''); setState('saved');
    onSaved?.();
    setTimeout(() => setState('idle'), 2600);
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-2.5">
      <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
      <input
        ref={ref}
        id="notice-input"
        value={text}
        onChange={(e) => { setText(e.target.value); if (state !== 'idle') setState('idle'); }}
        placeholder="What did you notice?"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-3)]"
      />
      {state === 'saved' ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--moss)]">
          <Check className="h-3.5 w-3.5" /> written down, unverified
        </span>
      ) : state !== 'idle' && state !== 'saving' ? (
        <span className="shrink-0 text-[11px] text-[var(--clay)]">{state}</span>
      ) : (
        <button
          type="submit"
          disabled={!text.trim() || state === 'saving'}
          className="shrink-0 rounded border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1 text-[11px]
                     font-medium hover:border-[var(--moss)] disabled:opacity-40">
          {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Note it'}
        </button>
      )}
    </form>
  );
}

function Cell({ icon: I, label, children }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
        <I className="h-3 w-3" /> {label}
      </div>
      {children}
    </div>
  );
}
const Value = ({ children }) => <div className="text-lg leading-tight tabular-nums">{children}</div>;
const Sub = ({ children, warn }) => (
  <div className={`mt-0.5 text-[11px] leading-snug ${warn ? 'text-[var(--clay)]' : 'text-[var(--ink-2)]'}`}>
    {children}
  </div>
);

const fmt = (n) =>
  n == null ? '—' : n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10);
const time = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  catch { return '—'; }
};
const year = (at) => String(at ?? '').slice(0, 4);
