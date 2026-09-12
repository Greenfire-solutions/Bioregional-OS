import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView, _GlobeView as GlobeView, COORDINATE_SYSTEM } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer, ColumnLayer, SolidPolygonLayer, TextLayer, IconLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import { Globe, Mountain, Layers, Loader2 } from 'lucide-react';
import { KIND, KIND_ORDER, markerSVG, badgeColor } from '../mapKinds.js';
import { callTool } from '../api.js';

// Carto's Positron — an open basemap style that needs no API key.
// Dark Matter, not Positron. The Atlas is the hero of this interface and a
// white rectangle sitting inside a dark console reads as a hole in it. Same
// open CARTO tiles, same no-key requirement, and extruded ecoregions lit
// against a dark ground look like what they are: land seen from above at night.
const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// The same four voices the rest of the interface uses, in the form deck.gl
// wants. Luminous rather than muted, because on a dark ground a muted marker
// is not a subtle marker, it is an invisible one.
const SEVERITY_COLOR = {
  Critical: [245, 144, 106],   // clay
  Watch:    [232, 195, 107],   // gold
  Info:     [111, 200, 230],   // water
};

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

export default function Map3D({ places = [], hubs = [], signals = [], focus, onSelect }) {
  const [mode, setMode] = useState('terrain');          // terrain | globe
  const [level, setLevel] = useState('l3');             // ecoregion detail
  const [relief, setRelief] = useState(true);
  const [eco, setEco] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);
  const [showSignals, setShowSignals] = useState(true);
  const [features, setFeatures] = useState([]);
  // Instrument readings are OFF by default. There are 68 of them against 5
  // observations in the example commons — a map showing both at once is a map
  // of the gage, and what a person noticed disappears underneath what a machine
  // reported. Everything a person did is on; the machines are a toggle.
  const [kindsOn, setKindsOn] = useState(
    () => new Set(KIND_ORDER.filter((k) => k !== 'reading')));
  const fetchRef = useRef(0);

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

    if (showSignals && signals.length) {
      const pts = signals.filter((s) => s.lat != null && s.lng != null);
      // Two layers, because a pin on a map is a claim and these are two
      // different claims.
      //
      // A surveyed observation and a USGS gage carry their OWN coordinates —
      // somebody stood there, or the instrument is bolted there. A NOAA advisory
      // covering sixteen counties is filed at the place's point, and so is a
      // one-line daily notice typed from the kitchen table. Drawing all four as
      // identical columns says something the data does not support, so anything
      // sitting on a borrowed coordinate gets a flat translucent disc instead:
      // present and locatable, visibly not a pin in the ground.
      const located = pts.filter((d) => d.at_place_centroid !== 1);
      const approximate = pts.filter((d) => d.at_place_centroid === 1);

      const hoverFor = (i, kind, extra) => setHover(i.object ? {
        x: i.x, y: i.y, title: i.object.title,
        sub: `${i.object.severity} · ${i.object.category}` +
             (i.object.quantity_value != null ? ` · ${i.object.quantity_value} ${i.object.quantity_unit ?? ''}` : '') +
             (extra ? ` · ${extra(i.object)}` : ''),
        kind,
      } : null);

      if (approximate.length) {
        L.push(new ScatterplotLayer({
          id: 'signals-approximate',
          data: approximate,
          pickable: true, stroked: true, filled: true,
          radiusUnits: 'meters', getRadius: 900, radiusMinPixels: 5, radiusMaxPixels: 60,
          lineWidthMinPixels: 1.5,
          getPosition: (d) => [d.lng, d.lat],
          getFillColor: (d) => [...(SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.Info), 55],
          getLineColor: (d) => [...(SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.Info), 200],
          parameters: { depthTest: false },
          onHover: (i) => hoverFor(i, 'Shown at the place, not its own location',
            (o) => (o.human_observed === 0
              ? `reported by ${o.source_adapter ?? 'an upstream'} · real extent is wider than this point`
              : `noted against the place${o.author ? ` by ${o.author}` : ''}`)),
          onClick: (i) => i.object && onSelect?.({ type: 'signal', item: i.object }),
        }));
      }

      L.push(new ColumnLayer({
        id: 'signals',
        data: located,
        diskResolution: 10, radius: 260, extruded: mode === 'terrain',
        pickable: true, elevationScale: 1,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => [...(SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.Info), 235],
        getElevation: (d) => ({ Critical: 5200, Watch: 3600 }[d.severity] ?? 2200),
        parameters: { depthTest: false },
        onHover: (i) => hoverFor(i, i.object?.human_observed === 0 ? 'Measured here' : 'Observed here',
          (o) => (o.verified ? 'verified' : 'unverified')),
        onClick: (i) => i.object && onSelect?.({ type: 'signal', item: i.object }),
      }));
    }

    if (hubs.length) {
      L.push(new ScatterplotLayer({
        id: 'hubs', data: hubs.filter((h) => h.lat != null),
        pickable: true, radiusUnits: 'pixels', getRadius: 9,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [79, 214, 160, 255], getLineColor: [8, 15, 13], lineWidthMinPixels: 2, stroked: true,
        parameters: { depthTest: false },
        onHover: (i) => setHover(i.object ? { x: i.x, y: i.y, title: i.object.name, sub: i.object.type, kind: 'Hub' } : null),
        onClick: (i) => i.object && onSelect?.({ type: 'hub', item: i.object }),
      }));
    }

    if (places.length) {
      L.push(new ScatterplotLayer({
        id: 'places', data: places.filter((p) => p.lat != null),
        pickable: true, radiusUnits: 'pixels', getRadius: 13,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [232, 195, 107, 255], getLineColor: [8, 15, 13], lineWidthMinPixels: 2.5, stroked: true,
        parameters: { depthTest: false },
        onHover: (i) => setHover(i.object ? {
          x: i.x, y: i.y, title: i.object.name,
          sub: [i.object.ecoregion_name, i.object.watershed_name].filter(Boolean).join(' · '),
          kind: 'Place',
        } : null),
        onClick: (i) => i.object && onSelect?.({ type: 'place', item: i.object }),
      }));
      if (mode === 'terrain') {
        L.push(new TextLayer({
          id: 'place-labels', data: places.filter((p) => p.lat != null),
          getPosition: (d) => [d.lng, d.lat], getText: (d) => d.name,
          getSize: 12, getColor: [233, 243, 236], getPixelOffset: [0, -20],
          fontFamily: 'ui-sans-serif, system-ui', background: true,
          getBackgroundColor: [8, 15, 13, 220], backgroundPadding: [6, 4],
          parameters: { depthTest: false },
        }));
      }
    }

    // ── Everything a commons is doing, on the ground it is doing it on ─────
    // Drawn last so it sits above the terrain, and ordered by each kind's own
    // `z` so a project is never hidden under a gage reading. Sorting rather
    // than one layer per kind keeps picking in a single pass, which is what
    // makes a click land on the thing under the cursor rather than the thing
    // that happened to be added last.
    const shown = features
      .filter((f) => kindsOn.has(f.kind))
      .sort((a, b) => (KIND[a.kind]?.z ?? 0) - (KIND[b.kind]?.z ?? 0));

    if (shown.length) {
      L.push(new IconLayer({
        id: 'commons-features',
        data: shown,
        pickable: true,
        getPosition: (d) => [d.lng, d.lat],
        getIcon: (d) => ({
          url: markerSVG(d.kind, { blocked: d.state === 'blocked', precise: d.precise !== false }),
          width: 64, height: 64, anchorX: 32, anchorY: 32, mask: false,
        }),
        getSize: (d) => KIND[d.kind]?.size ?? 18,
        sizeUnits: 'pixels',
        // Never scaled by zoom. A marker that shrinks to a pixel when you zoom
        // out is a marker you cannot find, and finding things is the point.
        sizeMinPixels: 10,
        // Above the extruded ecoregions. deck.gl buries point layers under
        // extruded polygons otherwise — the trap already documented for the
        // signal layers below.
        parameters: { depthTest: false },
        onHover: (i) => setHover(i.object ? {
          x: i.x, y: i.y,
          title: i.object.title,
          sub: [i.object.sub, i.object.precise === false ? 'at the centre of its place' : null]
            .filter(Boolean).join(' · '),
          kind: KIND[i.object.kind]?.label ?? i.object.kind,
        } : null),
        onClick: (i) => i.object && onSelect?.({ type: 'feature', item: i.object }),
        updateTriggers: { getIcon: [shown.map((f) => `${f.kind}${f.state}${f.precise}`).join()] },
      }));

      // The badge, on top of the marker: how many things are in a project's
      // way, how many days a need has waited, who said they are coming. The
      // whole reason it is drawn rather than left to the tooltip is that it has
      // to be readable WITHOUT hovering — a map you have to interrogate one
      // pin at a time is a list with extra steps.
      const badged = shown.filter((f) => f.badge);
      if (badged.length) {
        L.push(new TextLayer({
          id: 'commons-badges',
          data: badged,
          getPosition: (d) => [d.lng, d.lat],
          getText: (d) => String(d.badge),
          getSize: 11,
          getColor: (d) => badgeColor(d.kind, d.state === 'blocked'),
          fontFamily: 'ui-sans-serif, system-ui',
          fontWeight: 700,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          parameters: { depthTest: false },
          pickable: false,
          updateTriggers: { getColor: [badged.map((f) => f.state).join()] },
        }));
      }
    }

    return L;
  }, [eco, level, relief, mode, signals, hubs, places, showSignals, features, kindsOn]);

  useEffect(() => {
    let live = true;
    callTool('map_features', {})
      .then((r) => live && !r?.error && setFeatures(r.features ?? []))
      .catch(() => {});
    return () => { live = false; };
  }, [places.length, signals.length, hubs.length]);

  const views = mode === 'globe'
    ? new GlobeView({ id: 'globe', controller: true, resolution: 12 })
    : new MapView({ id: 'map', controller: true });

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1C2421]">
      <DeckGL
        views={views}
        viewState={mode === 'globe' ? { ...view, zoom: Math.min(view.zoom, 5), pitch: 0, bearing: 0 } : view}
        onViewStateChange={({ viewState }) => setView(viewState)}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      >
        {mode === 'terrain' && (
          <Map reuseMaps mapStyle={BASEMAP} attributionControl={{ compact: true }} />
        )}
      </DeckGL>

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
      </div>

      {/* ── The key, which is also the switches ───────────────────────────
          A legend that only explains is a legend nobody reads twice. This one
          is the control: each row says what a symbol means AND turns it off,
          so the question "what is that shape?" and the action "stop showing
          me those" are the same click. Counts are on each row, because the
          most useful thing about a layer is often how much of it there is —
          sixty-eight readings against five observations is the reason the
          readings start switched off. */}
      <div className="absolute bottom-3 left-3 z-10 rounded border border-[var(--line)]
                      bg-[var(--paper)]/95 p-2 shadow-sm backdrop-blur">
        <div className="mb-1 px-1 text-[9px] uppercase tracking-wide text-[var(--ink-3)]">
          On the map
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
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px]
                            transition-colors disabled:opacity-35 ${
                  on ? 'text-[var(--ink)] hover:bg-[var(--paper-2)]'
                     : 'text-[var(--ink-3)] hover:bg-[var(--paper-2)]'}`}>
                <img src={markerSVG(k, { precise: true })} alt=""
                     className={`h-3.5 w-3.5 shrink-0 ${on ? '' : 'opacity-30 grayscale'}`} />
                <span className="whitespace-nowrap">{KIND[k].label}</span>
                <span className="ml-auto pl-1.5 text-[var(--ink-3)]">{n}</span>
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
            <span className="max-w-[9.5rem] text-[9px] leading-snug text-[var(--ink-3)]">
              Hollow and dashed: no coordinate of its own, drawn at the centre of its place.
            </span>
          </div>
        )}
      </div>

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
      <div className="pointer-events-none absolute bottom-6 left-3 max-w-[calc(100%-1.5rem)]
                      rounded bg-[var(--paper)]/90 px-2 py-1 text-[10px] text-[var(--ink-3)]
                      md:left-[13.5rem]">
        Ecoregions: EPA Level III & IV (public domain) · relief is visual separation, not elevation
      </div>
    </div>
  );
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
