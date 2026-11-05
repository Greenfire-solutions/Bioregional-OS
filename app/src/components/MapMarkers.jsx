import React, { useMemo, useState } from 'react';
import { WebMercatorViewport } from '@deck.gl/core';
import { KIND, needsAttention } from '../mapKinds.js';

/**
 * The commons, drawn over the map as real elements rather than pictures.
 *
 * The first attempt drew each feature as an SVG icon inside the canvas with a
 * number stamped on top. It was legible in a screenshot and unpleasant to use:
 * a "9" crammed into a small diamond, a "24" in a circle overlapping it, and
 * two heavy black label boxes across the middle of Austin colliding with both.
 * Nothing had a hierarchy, nothing responded to a pointer, and none of it read
 * at a glance from any distance.
 *
 * Canvas icons could not fix that. Text inside a texture cannot reflow, a shape
 * cannot grow to fit a label, and neither can transition. So the markers are
 * HTML positioned over the deck.gl canvas, projected through the same viewport
 * deck is rendering with — which is cheap here because everything a person put
 * on the map is a handful of rows, not a tile layer.
 *
 * Three rules give it the hierarchy the icons never had:
 *
 *   NOT EVERYTHING SHOUTS. A place is the ground the chapter stewards, so it
 *   carries its name — where there is room for it, and see the collision pass
 *   below. A project, need or gathering shows a compact pill with its count.
 *   An observation or a reading is a dot. Three weights, and the eye lands on
 *   the anchor first.
 *
 *   THE LABEL ARRIVES ON APPROACH. Titles appear on hover rather than being
 *   painted permanently across the map, which is what made two place names into
 *   a wall. Reading the map and interrogating one pin are different activities
 *   and only the second needs the words.
 *
 *   WHAT IS WRONG IS WHAT IS LOUD. A blocked project is the one thing worth
 *   seeing from across the map, so it is the only marker that pulses — slowly,
 *   once every few seconds, and never more than one kind at a time. If
 *   everything moved, nothing would be moving.
 */
export default function MapMarkers({ view, width, height, features, kindsOn, selectedId, onPick }) {
  const [hovered, setHovered] = useState(null);

  const placed = useMemo(() => {
    if (!width || !height) return [];
    let vp;
    try { vp = new WebMercatorViewport({ ...view, width, height }); } catch { return []; }
    return features
      .filter((f) => kindsOn.has(f.kind) && f.lat != null && f.lng != null)
      .map((f) => {
        const [x, y] = vp.project([f.lng, f.lat]);
        return { ...f, x, y };
      })
      // A marker off-screen is a DOM node doing nothing. The margin keeps the
      // ones just past the edge so they slide in rather than pop.
      .filter((f) => f.x > -120 && f.x < width + 120 && f.y > -80 && f.y < height + 80)
      // Painter's order: the quiet things first, so a project is never buried
      // under a gage reading, and whatever the pointer is on comes last.
      .sort((a, b) => (KIND[a.kind]?.z ?? 0) - (KIND[b.kind]?.z ?? 0));
  }, [view, width, height, features, kindsOn]);

  /**
   * Move markers off each other, so a number is never half of another marker.
   *
   * Two things a kilometre apart are one pixel at a regional zoom, and thirteen
   * markers were arriving as two visible pills with eleven stacked underneath.
   * Worse than hidden: a place's dot sat exactly over the "2" of a gathering's
   * "24", so the map read "4" — confidently, and wrong, which is the failure
   * this whole project treats as the serious one.
   *
   * A short outward spiral from the true point, in screen space, on collision
   * only. Something that has been moved is drawn with a thread back to where it
   * really is, because a marker that quietly relocates is the same lie in a
   * different font.
   */
  const laidOut = useMemo(() => {
    const done = [];
    const clashes = (a, b) => Math.abs(a.px - b.px) < a.w / 2 + b.w / 2 + 3
      && Math.abs(a.py - b.py) < 24;
    return placed.map((f) => {
      const w = f.kind === 'place' || f.kind === 'hub' ? 22 : f.badge != null ? 40 : 16;
      let px = f.x, py = f.y, moved = false;
      for (let i = 0; i < 24; i++) {
        const cand = { px, py, w };
        if (!done.some((d) => clashes(cand, d))) break;
        // A ring at a time: eight positions, then further out. Deterministic,
        // so the same map lays out the same way twice and markers do not shuffle
        // when something unrelated changes.
        const ring = Math.floor(i / 8) + 1;
        const angle = ((i % 8) / 8) * Math.PI * 2;
        px = f.x + Math.cos(angle) * (16 * ring);
        py = f.y + Math.sin(angle) * (14 * ring);
        moved = true;
      }
      done.push({ px, py, w });
      return { ...f, x: px, y: py, trueX: f.x, trueY: f.y, moved };
    });
  }, [placed]);

  /**
   * Which markers may keep their name, and which fall back to a dot.
   *
   * Two places two kilometres apart are the same pixel at a regional zoom, so
   * their labels sat on top of each other and the project pills landed on top
   * of both — the wall of text this rewrite was meant to remove, rebuilt out of
   * nicer parts. Labels are laid out from the most important down, and one that
   * would land on a box already taken keeps its dot and loses its words.
   *
   * A greedy pass over a handful of rectangles, deliberately: an interface that
   * a person is dragging has to settle within a frame, and the cost of the
   * occasional imperfect choice is one unlabelled dot that still shows its name
   * when the pointer reaches it.
   */
  const labelled = useMemo(() => {
    const keep = new Set();
    // Zoomed out past a town, a name is noise: the dots say where things are
    // and hovering says what they are.
    if ((view?.zoom ?? 0) < 8.5) return keep;

    // Every marker's own footprint is reserved first, each tagged with whose it
    // is — because a label grows out of its OWN marker and would otherwise be
    // tested against it. That was the bug: a place's label box started at
    // f.x + 8 while its own footprint ran to f.x + 11, so every place name
    // collided with the dot it belonged to and NO place name was ever drawn.
    // The rule looked like a collision rule working hard and was a rule that
    // could never say yes.
    const taken = [];
    const hits = (box, ownerId) => taken.some((t) =>
      t.owner !== ownerId &&
      box.x1 > t.x0 && box.x0 < t.x1 && box.y1 > t.y0 && box.y0 < t.y1);

    const footprint = (f) => {
      const w = f.kind === 'place' || f.kind === 'hub' ? 22
        : f.badge != null ? 40 : 16;
      return { owner: f.id, x0: f.x - w / 2, x1: f.x + w / 2, y0: f.y - 11, y1: f.y + 11 };
    };
    for (const f of laidOut) taken.push(footprint(f));

    // Then names, most important first, each against everything already there
    // except its own marker.
    for (const f of [...laidOut].reverse()) {
      if (f.kind !== 'place') continue;
      const w = 26 + Math.min(String(f.title ?? '').length, 30) * 6.2;
      const box = { owner: f.id, x0: f.x + 8, x1: f.x + 8 + w, y0: f.y - 11, y1: f.y + 11 };
      if (hits(box, f.id)) continue;
      taken.push(box);
      keep.add(f.id);
    }
    return keep;
  }, [laidOut, view?.zoom]);

  if (!laidOut.length) return null;

  return (
    // Transparent to the pointer as a whole, so dragging the map still works;
    // each marker turns it back on for itself.
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* A hairline from a nudged marker back to the point it actually marks.
          Moving a marker to make it readable is fine; moving it silently is
          the same overstatement as drawing a borrowed coordinate as a precise
          one, which this map already refuses to do. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        {laidOut.filter((f) => f.moved).map((f) => (
          <line key={`t:${f.kind}:${f.id}`}
                x1={f.trueX} y1={f.trueY} x2={f.x} y2={f.y}
                stroke="rgba(233,243,236,0.28)" strokeWidth="1" strokeDasharray="2 2" />
        ))}
      </svg>
      {laidOut.map((f) => {
        const k = KIND[f.kind] ?? KIND.observation;
        const blocked = needsAttention(f);
        const c = blocked && k.blockedColor ? k.blockedColor : k.color;
        const rgb = `rgb(${c[0]},${c[1]},${c[2]})`;
        const isOn = hovered === f.id || selectedId === f.id;
        const borrowed = f.precise === false;

        // Three weights. `anchor` carries its name when there is room, `pill`
        // carries a count, `dot` carries nothing until you approach it.
        const weight = f.kind === 'place' ? 'anchor'
          : ['project', 'need', 'gathering', 'hub'].includes(f.kind) ? 'pill' : 'dot';
        // An anchor that lost the collision keeps its dot and finds its name
        // again the moment a pointer arrives.
        const named = weight === 'anchor' && labelled.has(f.id);

        return (
          <button
            key={`${f.kind}:${f.id}`}
            onClick={(e) => { e.stopPropagation(); onPick?.(f); }}
            onMouseEnter={() => setHovered(f.id)}
            onMouseLeave={() => setHovered((h) => (h === f.id ? null : h))}
            className="pointer-events-auto absolute transition-[transform,filter] duration-150
                       ease-out focus:outline-none"
            style={{
              left: f.x, top: f.y,
              // Anchored on the GLYPH, not on the middle of the pill.
              //
              // Centring the whole element meant that the moment a label
              // appeared the pill grew and the dot slid sideways off the point
              // it marks — the marker walking away from its own coordinate at
              // the exact moment somebody reached for it. The glyph now sits on
              // the point and the label grows rightwards out of it, so hovering
              // lifts the marker toward the reader and moves nothing on the
              // ground. transformOrigin keeps the scale honest too: it grows
              // around the dot rather than around the text.
              transform: `translate(${weight === 'dot' ? -8.5 : -10.5}px, -50%) scale(${isOn ? 1.12 : 1})`,
              transformOrigin: `${weight === 'dot' ? 8.5 : 10.5}px center`,
              zIndex: isOn ? 60 : 10 + (KIND[f.kind]?.z ?? 0),
              filter: isOn ? 'drop-shadow(0 4px 10px rgba(0,0,0,.55))' : 'drop-shadow(0 2px 4px rgba(0,0,0,.45))',
            }}
            title={KIND[f.kind]?.what}
          >
            <span className="flex items-center gap-1.5 rounded-full border py-[3px] pl-[3px] pr-[3px]
                             backdrop-blur-[2px] transition-[padding,background-color] duration-150"
              style={{
                borderColor: rgb,
                borderStyle: borrowed ? 'dashed' : 'solid',
                borderWidth: weight === 'dot' ? 1.5 : 1.5,
                background: isOn ? 'rgba(12,18,15,0.92)' : 'rgba(12,18,15,0.72)',
                paddingRight: (weight === 'dot' && !isOn) ? 3 : 8,
                // Around the whole capsule, where there is room for a ring to
                // be seen. Still the only thing on the map that moves.
                animation: blocked ? 'bros-pulse 3s ease-in-out infinite' : 'none',
              }}>
              {/* The glyph. A filled core for something standing where it says
                  it is; a hollow one for a coordinate it borrowed. */}
              <span
                className="block shrink-0 rounded-full"
                style={{
                  width: weight === 'dot' ? 8 : 12,
                  height: weight === 'dot' ? 8 : 12,
                  background: borrowed ? 'transparent' : rgb,
                  border: borrowed ? `2px dashed ${rgb}` : `2px solid ${rgb}`,
                  // The pulse used to live here, on the 12px dot — inside the
                  // pill's own 2px stroke, which painted over most of the ring.
                  // Two frames a second and a half apart were indistinguishable
                  // at 2x magnification. It is on the pill now.
                }}
              />

              {/* The count, when there is one worth reading without clicking. */}
              {f.badge != null && weight !== 'dot' && (
                <span className="text-[11px] font-semibold leading-none tabular-nums"
                      style={{ color: rgb }}>
                  {f.badge}
                </span>
              )}

              {/* The name. Always for a place, on approach for everything else —
                  two permanent labels were what made the middle of the map a
                  wall of black boxes. */}
              {(named || isOn) && (
                <span className="max-w-[17rem] truncate whitespace-nowrap pr-1 text-[11px]
                                 leading-none text-[var(--ink)]">
                  {f.title}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
