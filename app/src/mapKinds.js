// ── How each kind of thing looks on the map ───────────────────────────────
// One definition per kind, read by three things that would otherwise drift
// apart: the layers that draw the markers, the key in the corner that explains
// them, and the panel that opens when one is clicked.
//
// The keys here must match engines/mapboard.mjs's MAP_KINDS exactly, and a test
// asserts it — a kind drawn but missing from the key is a symbol nobody can
// read, and a kind in the key but never drawn is a promise the map does not
// keep.
//
// Shape AND colour, never colour alone. Roughly one man in twelve cannot
// reliably separate the reds from the greens, and this map uses both to mean
// opposite things — a blocked project and a running one. Anything that depends
// on telling those apart has to work in greyscale too, so the shapes differ as
// well and the key shows both.

export const KIND = {
  place: {
    label: 'Places', shape: 'ring', color: [212, 175, 55],
    what: 'Ground this chapter stewards', size: 26, z: 5,
  },
  hub: {
    label: 'Hubs', shape: 'square', color: [138, 109, 31],
    what: 'Somewhere people can actually meet', size: 22, z: 4,
  },
  project: {
    label: 'Projects', shape: 'diamond', color: [90, 124, 99],
    // A project that cannot proceed is the single most useful thing to be able
    // to see from across the map, so it is the one kind that changes colour.
    blockedColor: [176, 106, 84], size: 28, z: 6,
    what: 'A project. Red when something is in its way; the number is how many',
  },
  need: {
    label: 'Needs brought', shape: 'triangle', color: [176, 106, 84],
    what: 'Somebody asked for something and is waiting; the number is days', size: 24, z: 7,
  },
  gathering: {
    label: 'Gatherings', shape: 'circle', color: [93, 138, 158],
    what: 'A gathering; the number is who said they are coming', size: 24, z: 3,
  },
  observation: {
    label: 'What people noticed', shape: 'dot', color: [122, 156, 122],
    what: 'Somebody stood there and wrote it down', size: 16, z: 2,
  },
  reading: {
    label: 'Instrument readings', shape: 'tick', color: [108, 142, 158],
    what: 'A gage or an alert reported it; nobody was there', size: 11, z: 1,
  },
};

/** The order the key lists them: what a person made, before what a machine did. */
export const KIND_ORDER = ['place', 'hub', 'project', 'need', 'gathering', 'observation', 'reading'];

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * A marker, as an SVG data URI.
 *
 * Drawn rather than picked from an icon font so the shapes stay legible at the
 * sizes a map actually uses them, and so a borrowed coordinate can be drawn as
 * the same shape without a fill — see below.
 *
 * `precise: false` means the thing has no coordinate of its own and is sitting
 * at the centre of the place it belongs to. Those are hollow and dashed, which
 * is the map admitting the difference rather than quietly asserting a precision
 * it does not have.
 */
export function markerSVG(kind, { blocked = false, precise = true } = {}) {
  const k = KIND[kind] ?? KIND.observation;
  const c = blocked && k.blockedColor ? k.blockedColor : k.color;
  const fill = precise ? rgb(c) : 'none';
  const stroke = rgb(c);
  const sw = precise ? 2 : 2.5;
  const dash = precise ? '' : ' stroke-dasharray="4 3"';
  const body = {
    ring: `<circle cx="16" cy="16" r="9" fill="none" stroke="${stroke}" stroke-width="3.5"${dash}/>`,
    square: `<rect x="7" y="7" width="18" height="18" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    diamond: `<path d="M16 4 L28 16 L16 28 L4 16 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    triangle: `<path d="M16 5 L28 27 L4 27 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    circle: `<circle cx="16" cy="16" r="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    dot: `<circle cx="16" cy="16" r="7" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    tick: `<circle cx="16" cy="16" r="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`,
  }[k.shape] ?? `<circle cx="16" cy="16" r="7" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

  // A thin dark halo under every marker, so a pale shape stays visible over
  // pale terrain and a dark one stays visible over water.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
    `<g opacity="0.55" transform="translate(0,1)" stroke="#0D1310" fill="none" stroke-width="${sw + 2.5}">${body}</g>` +
    `${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The colour the badge number is drawn in, for contrast against the marker. */
export function badgeColor(kind, blocked) {
  const k = KIND[kind] ?? KIND.observation;
  const c = blocked && k.blockedColor ? k.blockedColor : k.color;
  // Luminance, so the number is dark on a light marker and light on a dark one
  // rather than the same colour everywhere and invisible on half of them.
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return lum > 0.6 ? [20, 28, 24, 255] : [247, 245, 240, 255];
}
