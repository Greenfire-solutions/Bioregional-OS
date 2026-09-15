import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView, _GlobeView as GlobeView, COORDINATE_SYSTEM } from '@deck.gl/core';
import { GeoJsonLayer, SolidPolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import { Globe, Mountain, Layers, Loader2, Plus, X, Flag, ListChecks, Radio,
         MapPin, Home, Crosshair } from 'lucide-react';
import { KIND, KIND_ORDER, markerSVG, needsAttention } from '../mapKinds.js';
import MapMarkers from './MapMarkers.jsx';
import { callTool } from '../api.js';

// Carto's Positron — an open basemap style that needs no API key.
// Dark Matter, not Positron. The Atlas is the hero of this interface and a
// white rectangle sitting inside a dark console reads as a hole in it. Same
// open CARTO tiles, same no-key requirement, and extruded ecoregions lit
// against a dark ground look like what they are: land seen from above at night.
const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';


/** Stable colour per ecoregion name — the same region is the same colour every load. */
function colorFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  // Lifted in saturation and lightness for a dark basemap — the previous
  // values were tuned against white and go to mud against black.
  return hsl(h % 360, 46 + (h % 18), 46 + ((h >> 3) % 14));
}
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

export default function Map3D({ places = [], hubs = [], signals = [], focus, onSelect,
                                onAddHere, moving = null, onMoved, onCancelMove,
                                version = 0, selectedId = null }) {
  const [mode, setMode] = useState('terrain');          // terrain | globe
  const [level, setLevel] = useState('l3');             // ecoregion detail
  const [relief, setRelief] = useState(true);
  const [eco, setEco] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);
  const [features, setFeatures] = useState([]);
  // The canvas's own size, measured rather than assumed: the map column
  // changes width whenever the detail panel opens, and a projection computed
  // against the wrong width puts every marker in the wrong place.
  const wrapRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setBox({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Instrument readings are OFF by default. There are 68 of them against 5
  // observations in the example commons — a map showing both at once is a map
  // of the gage, and what a person noticed disappears underneath what a machine
  // reported. Everything a person did is on; the machines are a toggle.
  const [kindsOn, setKindsOn] = useState(
    () => new Set(KIND_ORDER.filter((k) => k !== 'reading')));
  const fetchRef = useRef(0);
  // ── A point somebody has just pressed on the ground ─────────────────────
  // The map could be read and not written to, which made it the one screen in
  // the OS where the answer to "so what do I do about that?" was to go and find
  // a form somewhere else and type a coordinate into it by hand. A person
  // looking at a washed-out crossing is already pointing at where the work is.
  //
  // Held here rather than lifted to App, because it is about a gesture on this
  // canvas and it is thrown away the moment anything is chosen.
  const [dropped, setDropped] = useState(null);
  // ── Placing mode ────────────────────────────────────────────────────────
  // The first version of this listened for a click that hit NO layer, which is
  // a condition that never happens. The ecoregion layer is `pickable` and
  // `filled` and tiles the entire viewport, so every press on land is answered
  // by it — `info.layer` is always set, the handler always returned early, and
  // the gesture was dead from the moment it shipped. It could not be found
  // because it did not exist.
  //
  // Two presses instead of a secret one: arm it, then place it. That works over
  // the ecoregion layer without taking the region panel away — a single click
  // still opens what is known about a region, which is the other thing this map
  // is for — and, unlike a hidden gesture, it can be SEEN. The button is the
  // documentation.
  const [placing, setPlacing] = useState(false);
  // Moving something re-uses the placing mechanism exactly: arm, then press.
  // Nobody types a coordinate they can point at, and a "Move it" that opened a
  // form with two number fields in it would be the thing this whole gesture
  // exists to replace.
  const armed = placing || !!moving;
  useEffect(() => {
    if (!armed) return;
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      setPlacing(false); setDropped(null); onCancelMove?.();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [armed, onCancelMove]);

  const home = places[0] ?? { lat: 30.26, lng: -97.79 };
  const [view, setView] = useState({
    longitude: home.lng, latitude: home.lat, zoom: 8.6, pitch: 48, bearing: -16,
  });

  useEffect(() => {
    if (!focus) return;
    setView((v) => ({ ...v, longitude: focus.lng, latitude: focus.lat, zoom: 12, transitionDuration: 900 }));
  }, [focus]);

  // Pull ecoregion polygons for the current viewport, debounced.
  useEffect(() => {
    const id = ++fetchRef.current;
    const t = setTimeout(async () => {
      const span = mode === 'globe' ? 40 : Math.max(0.25, 22 / Math.pow(2, view.zoom - 6));
      const bbox = [
        view.longitude - span, view.latitude - span * 0.7,
        view.longitude + span, view.latitude + span * 0.7,
      ].map((n) => n.toFixed(3)).join(',');
      setLoading(true);
      try {
        const r = await fetch(`/api/layers/ecoregions?bbox=${bbox}&level=${level}`);
        const gj = await r.json();
        if (id === fetchRef.current) setEco(gj);
      } catch { /* offline: keep the last layer on screen */ }
      finally { if (id === fetchRef.current) setLoading(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [view.longitude, view.latitude, Math.round(view.zoom), level, mode]);

  const layers = useMemo(() => {
    const L = [];

    if (mode === 'globe') {
      L.push(new SolidPolygonLayer({
        id: 'earth',
        data: [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]],
        getPolygon: (d) => d, stroked: false, filled: true,
        getFillColor: [10, 20, 17], _full3d: false,
      }));
    }

    if (eco?.features?.length) {
      L.push(new GeoJsonLayer({
        id: `eco-${level}`,
        data: eco,
        pickable: true,
        stroked: true, filled: true,
        extruded: relief && mode === 'terrain',
        wireframe: false,
        getFillColor: (f) => [...colorFor(f.properties.display_name), mode === 'globe' ? 210 : 88],
        getLineColor: [247, 245, 240, 180],
        getLineWidth: 60,
        lineWidthMinPixels: 0.8,
        // Relief is visual separation between neighbouring regions, not measured elevation.
        getElevation: (f) => (relief ? 900 + (colorFor(f.properties.display_name)[0] % 9) * 500 : 0),
        onHover: (i) => setHover(i.object ? {
          x: i.x, y: i.y,
          title: i.object.properties.display_name,
          sub: `${i.object.properties.division ?? ''} · ${i.object.properties.biome ?? ''}`,
          kind: 'Ecoregion',
        } : null),
        // Every polygon already carried its own code and nothing ever asked for
        // it. A region you can hover but not open is a map of labels — the
        // dossier behind each one is the whole point of the library.
        onClick: (i) => i.object && onSelect?.({
          type: 'ecoregion',
          item: {
            code: String(i.object.properties.display_code ?? '').toLowerCase(),
            scheme: level === 'l4' ? 'epa-l4' : 'epa-l3',
            name: i.object.properties.display_name,
            // The same normalised fields the hover tooltip reads. The raw
            // NA_L1NAME/NA_L2NAME are shouted upper case straight from the
            // EPA service — adapters/layers.mjs already tidies them, and two
            // parts of one map should not disagree about a region's division.
            division: i.object.properties.division ?? null,
            biome: i.object.properties.biome ?? null,
          },
        }),
        updateTriggers: { getElevation: [relief], getFillColor: [mode] },
      }));
    }

    // The signal, hub and place layers that used to live here are gone.
    //
    // They drew the same rows the commons-features layer below now draws, so
    // every place, hub and signal was painted twice — and only the new copy
    // answered the key's switches. Turning "Instrument readings" off changed
    // nothing on screen, because sixty-eight gage columns were coming from a
    // layer with no switch at all. The map stayed a map of the gage, which is
    // the exact outcome splitting observations from readings was built to
    // prevent.
    //
    // Adding a layer without removing the one it replaces leaves a map that
    // looks finished, which is why it survived a screenshot. ARCHITECTURE.md
    // records the mirror of this — an edit that deleted three map layers and
    // left something that also looked plausible.
    //
    // The place LABELS are kept, because a name beside a point is not a second
    // copy of the point. They now follow the same switch as the places.

    // The markers used to be drawn here, as SVG icons in the canvas with a
    // number stamped over each one. Text inside a texture cannot reflow, a
    // shape cannot grow to fit a label, and neither can transition — so a "9"
    // sat crammed in a diamond next to a "24" in a circle, under two permanent
    // black label boxes, and none of it responded to a pointer.
    //
    // They are HTML now, in MapMarkers.jsx, positioned over this canvas through
    // the same viewport deck is rendering with. Everything a person put on the
    // map is a handful of rows, so the cost is nothing and the control is total.
    //
    // Globe mode keeps a plain dot layer: WebMercatorViewport cannot project a
    // globe, and rather than quietly putting markers in the wrong place it
    // draws something simpler and honest about being simpler.
    if (mode === 'globe' && features.length) {
      const shown = features.filter((f) => kindsOn.has(f.kind) && f.lat != null && f.lng != null);
      if (shown.length) {
        L.push(new ScatterplotLayer({
          id: 'globe-features', data: shown, pickable: true,
          radiusUnits: 'pixels', getRadius: 5, radiusMinPixels: 3,
          getPosition: (d) => [d.lng, d.lat],
          getFillColor: (d) => {
            const k = KIND[d.kind] ?? KIND.observation;
            return needsAttention(d) && k.blockedColor ? k.blockedColor : k.color;
          },
          getLineColor: [8, 15, 13], lineWidthMinPixels: 1.5, stroked: true,
          parameters: { depthTest: false },
          onClick: (i) => i.object && onSelect?.({ type: 'feature', item: i.object }),
          updateTriggers: { getFillColor: [shown.map((f) => f.state).join()] },
        }));
      }
    }

    return L;
  }, [eco, level, relief, mode, signals, hubs, places, features, kindsOn, onSelect]);

  // Keyed on `version`, not on row counts. Closing a gate — the very action the
  // panel offers — changes no count anywhere: the same quests, places and
  // signals come back, so the badge stayed at eight and the diamond stayed red
  // until something unrelated was added or the page was reloaded. App bumps
  // this whenever it reloads the commons, which is after every action.
  useEffect(() => {
    let live = true;
    callTool('map_features', {})
      .then((r) => live && !r?.error && setFeatures(r.features ?? []))
      .catch(() => {});
    return () => { live = false; };
  }, [version, places.length, signals.length, hubs.length]);

  const views = mode === 'globe'
    ? new GlobeView({ id: 'globe', controller: true, resolution: 12 })
    : new MapView({ id: 'map', controller: true });

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#1C2421]"
         onMouseLeave={() => setHover(null)}>
      <DeckGL
        views={views}
        viewState={mode === 'globe' ? { ...view, zoom: Math.min(view.zoom, 5), pitch: 0, bearing: 0 } : view}
        onViewStateChange={({ viewState }) => setView(viewState)}
        // scrollZoom named explicitly. It is on by default, but the wheel was
        // reported dead and an option that is only on by default is one a
        // future prop spread can switch off without anybody noticing.
        controller={{ dragRotate: true, touchRotate: true, scrollZoom: true, doubleClickZoom: true }}
        layers={layers}
        // A press on the GROUND, meaning no layer answered for it. An
        // ecoregion click opens the region panel and a marker click opens the
        // feature, and both of those arrive with `info.layer` set — so this
        // fires only when somebody pressed a piece of land that has nothing on
        // it yet, which is exactly when "put something here" is the right offer.
        //
        // Terrain only. A globe has no WebMercator projection to invert, and a
        // coordinate quietly taken from the wrong one would file work in the
        // wrong field.
        onClick={(info) => {
          // In placing mode the coordinate is taken WHATEVER answered for the
          // press — the ecoregion polygon under the cursor is not a reason to
          // refuse a point on it. Out of placing mode nothing here fires, and
          // the layers keep their own clicks.
          if (!armed || mode !== 'terrain') return;
          if (!Array.isArray(info?.coordinate)) return;
          const [lng, lat] = info.coordinate;
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
          const at = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
          if (moving) { onMoved?.(at); return; }
          setPlacing(false);
          setDropped({ lng, lat, x: info.x, y: info.y });
        }}
        getCursor={({ isHovering }) => (armed ? 'crosshair' : isHovering ? 'pointer' : 'grab')}
      >
        {mode === 'terrain' && (
          <Map reuseMaps mapStyle={BASEMAP} attributionControl={{ compact: true }} />
        )}
      </DeckGL>

      {mode === 'terrain' && (
        <MapMarkers
          view={view} width={box.width} height={box.height}
          // Selection is owned by whoever owns the panel, not by the map.
          // Two sources of truth meant closing the panel left the marker
          // permanently expanded — it survived zooming, toggling its whole kind
          // off and back on, and a full drag. Only a reload cleared it.
          features={features} kindsOn={kindsOn} selectedId={selectedId}
          onPick={(f) => onSelect?.({ type: 'feature', item: f })}
        />
      )}

      {/* controls */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <div className="flex overflow-hidden rounded border border-[var(--line)] bg-[var(--paper)] shadow-sm">
          <Btn active={mode === 'terrain'} onClick={() => setMode('terrain')} icon={Mountain} label="Terrain" />
          <Btn active={mode === 'globe'} onClick={() => setMode('globe')} icon={Globe} label="Globe" />
        </div>
        <div className="flex overflow-hidden rounded border border-[var(--line)] bg-[var(--paper)] shadow-sm">
          <Btn active={level === 'l3'} onClick={() => setLevel('l3')} label="Level III" />
          <Btn active={level === 'l4'} onClick={() => setLevel('l4')} label="Level IV" />
        </div>
        <div className="flex overflow-hidden rounded border border-[var(--line)] bg-[var(--paper)] shadow-sm">
          <Btn active={relief} onClick={() => setRelief((v) => !v)} icon={Layers} label="Relief" />
        </div>
        {/* The map was readable and not writable, and the gesture that was
            meant to fix that could not be seen. A button can. */}
        {mode === 'terrain' && (
          <div className="flex overflow-hidden rounded border border-[var(--line)] bg-[var(--paper)] shadow-sm">
            <Btn active={placing} onClick={() => { setPlacing((v) => !v); setDropped(null); }}
                 icon={placing ? Crosshair : Plus}
                 label={placing ? 'Press the map' : 'Put something here'} />
          </div>
        )}
      </div>

      {/* ── The key, which is also the switches ───────────────────────────
          A legend that only explains is a legend nobody reads twice. This one
          is the control: each row says what a symbol means AND turns it off,
          so the question "what is that shape?" and the action "stop showing
          me those" are the same click. Counts are on each row, because the
          most useful thing about a layer is often how much of it there is —
          sixty-eight readings against five observations is the reason the
          readings start switched off. */}
      {/* Bottom-left, and on a narrow window the credit moves ABOVE it rather
          than under it. Credit that is covered is credit not given, and the
          ecoregion layer's licence requires it — so the two are given
          non-overlapping space at every width rather than only on a desktop. */}
      <div className="absolute bottom-3 left-3 z-20 max-h-[calc(100%-5rem)] overflow-y-auto rounded-lg
                      border border-[var(--line)] bg-[var(--paper)]/80 p-1.5 shadow-lg backdrop-blur-md">
        <div className="mb-1 px-1.5 text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
          On the map
        </div>
        {/* A gesture nobody is told about is a gesture nobody makes. One line,
            in the panel a person already reads to work out what the shapes
            mean. */}
        <div className="mb-1 flex items-center gap-1 px-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
          <Plus className="h-2.5 w-2.5 shrink-0" /> "Put something here", then press the map
        </div>
        <div className="flex flex-col gap-0.5">
          {KIND_ORDER.map((k) => {
            const n = features.filter((f) => f.kind === k).length;
            const on = kindsOn.has(k);
            return (
              <button key={k}
                onClick={() => setKindsOn((prev) => {
                  const s2 = new Set(prev);
                  if (s2.has(k)) s2.delete(k); else s2.add(k);
                  return s2;
                })}
                disabled={!n}
                title={KIND[k].what}
                className={`group flex items-center gap-2 rounded-full px-1.5 py-1 text-left
                            text-[10px] transition-all duration-150 disabled:opacity-30 ${
                  on ? 'bg-[var(--paper-2)] text-[var(--ink)]'
                     : 'text-[var(--ink-3)] hover:bg-[var(--paper-2)]/60'}`}>
                {/* The same glyph the marker uses, so the key is read once and
                    the map is read forever after. */}
                <span className="block h-2.5 w-2.5 shrink-0 rounded-full transition-all"
                      style={{
                        background: on ? `rgb(${KIND[k].color.join(',')})` : 'transparent',
                        border: `2px solid rgb(${KIND[k].color.join(',')})`,
                        opacity: on ? 1 : 0.35,
                      }} />
                <span className="whitespace-nowrap">{KIND[k].label}</span>
                <span className="ml-auto pl-2 tabular-nums text-[var(--ink-3)]">{n}</span>
              </button>
            );
          })}
        </div>
        {features.some((f) => f.precise === false) && (
          // Said once, where the shapes are explained, because a dashed hollow
          // marker is otherwise just a marker that looks slightly different.
          <div className="mt-1.5 flex items-start gap-1.5 border-t border-[var(--line)] px-1 pt-1.5">
            <img src={markerSVG('gathering', { precise: false })} alt=""
                 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {/* Was clipped by the viewport at 812px tall and stopped mid-sentence
                — "drawn at the centre of" and then nothing. A footnote that
                cannot finish makes the whole panel read as unfinished. */}
            <span className="max-w-[9.5rem] text-[9px] leading-snug text-[var(--ink-3)]">
              Hollow: no coordinate of its own.
            </span>
          </div>
        )}
      </div>

      {/* ── What to put here ──────────────────────────────────────────────
          Three things, because three is what a person standing at a spot
          actually has to say about it: this is a project, this is one job
          inside a project, or this is something I saw. Anything else is a form
          they can reach from the thing once it exists. */}
      {dropped && (
        <div className="absolute z-30 w-60 rounded-lg border border-[var(--line)] bg-[var(--paper)]
                        p-2.5 shadow-xl"
             style={{
               // Kept inside the canvas at every edge. A panel that opens off
               // the right-hand side of the map is a panel that reads as the
               // click having done nothing.
               left: Math.min(Math.max(8, dropped.x + 12), Math.max(8, box.width - 252)),
               top: Math.min(Math.max(8, dropped.y + 12), Math.max(8, box.height - 176)),
             }}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Put something here</div>
              <div className="font-data text-[11px] tabular-nums text-[var(--ink-2)]">
                {dropped.lat.toFixed(5)}, {dropped.lng.toFixed(5)}
              </div>
            </div>
            <button onClick={() => setDropped(null)}
                    className="shrink-0 rounded p-1 hover:bg-[var(--paper-2)]" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {/* Everything the schema can actually hold a coordinate for, and
                nothing it cannot. A gathering is missing on purpose: the
                gatherings table has no lat/lng, so offering to place one here
                would promise a precision the row cannot keep — the same
                distinction the map already draws between its own point and a
                borrowed one. */}
            {[
              { tool: 'add_place', icon: MapPin, label: 'A place',
                hint: 'Ground this chapter stewards' },
              { tool: 'add_hub', icon: Home, label: 'A hub',
                hint: 'Somewhere people can actually meet' },
              { tool: 'open_quest', icon: Flag, label: 'A project',
                hint: 'Something that needs doing, with gates on it' },
              { tool: 'add_task', icon: ListChecks, label: 'A task',
                hint: 'One job inside a project somebody can pick up' },
              { tool: 'add_signal', icon: Radio, label: 'Something I noticed',
                hint: 'An observation, here, now' },
            ].map(({ tool, icon: I, label, hint }) => (
              <button key={tool}
                onClick={() => {
                  // The coordinate travels into the form already filled in.
                  // Typing it by hand is the step this whole gesture removes,
                  // and a number retyped from a screen is a number entered wrong.
                  onAddHere?.(tool, { lat: Number(dropped.lat.toFixed(6)), lng: Number(dropped.lng.toFixed(6)) });
                  setDropped(null);
                }}
                className="group flex items-start gap-2 rounded px-2 py-1.5 text-left
                           hover:bg-[var(--paper-2)]">
                <I className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--moss)]" />
                <span className="min-w-0">
                  <span className="block text-[12px] leading-tight text-[var(--ink)]">{label}</span>
                  <span className="block text-[10px] leading-snug text-[var(--ink-3)]">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {armed && !dropped && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full
                        border border-[var(--gold)] bg-[var(--paper)] px-3 py-1.5 text-[11px]
                        text-[var(--ink)] shadow-lg">
          {moving
            ? `Press where "${truncate(moving.feature?.title, 34)}" should be — Esc to cancel`
            : 'Press the spot on the map where it goes — Esc to cancel'}
        </div>
      )}

      {loading && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded border border-[var(--line)]
                        bg-[var(--paper)] px-2.5 py-1.5 text-[11px] text-[var(--ink-2)] shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading ecoregions
        </div>
      )}

      {hover && (
        <div className="pointer-events-none absolute z-10 max-w-xs rounded border border-[var(--line)]
                        bg-[var(--paper)] px-2.5 py-2 text-xs shadow-lg"
             style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">{hover.kind}</div>
          <div className="font-medium text-[var(--ink)]">{hover.title}</div>
          {hover.sub && <div className="text-[var(--ink-2)]">{hover.sub}</div>}
        </div>
      )}

      {/* Moved out from under the key, which now occupies the bottom-left
          corner this used to have to itself. Credit that is covered up is
          credit not given — and the licence on this layer requires it. */}
      <div className="pointer-events-none absolute bottom-[17rem] left-3 max-w-[calc(100%-1.5rem)]
                      rounded bg-[var(--paper)]/90 px-2 py-1 text-[10px] text-[var(--ink-3)]
                      md:bottom-6 md:left-[13.5rem]">
        Ecoregions: EPA Level III & IV (public domain) · relief is visual separation, not elevation
      </div>
    </div>
  );
}

function truncate(s, n) {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function Btn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        active ? 'bg-[var(--moss)] text-[var(--paper)]' : 'text-[var(--ink-2)] hover:bg-[var(--line-2)]'}`}>
      {Icon && <Icon className="h-3.5 w-3.5" />}{label}
    </button>
  );
}
