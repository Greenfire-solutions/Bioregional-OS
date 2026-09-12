// ── Dispatch ──────────────────────────────────────────────────────────────
// The thing somebody pastes into the group chat.
//
// This engine exists because of the finding in docs/SOCIAL_LAYER.md §3.1: the
// group already lives somewhere — a WhatsApp or Signal thread — and it will not
// move to a localhost URL. Studies of neighbourhood mutual aid groups found the
// ward WhatsApp group WAS the organisation. So the OS does not try to become
// that place. It produces the message that goes into it.
//
// Three rules are built into the shape of this file rather than checked after:
//
//   1. IT SENDS NOTHING. There is no send here and there never will be. A human
//      posts it, at a moment they judge right, under their own name. A bot
//      posting on a schedule is a different social object, and an undifferentiated
//      group chat gets muted — after which the messages that mattered are missed
//      too (§3.2). One card a week, by a person, is the whole design.
//
//   2. IT IS COMPLETE IN ITSELF. There is no public URL for anyone not on the
//      wifi, so there is nothing to link to and no link preview to rely on.
//      Every fact the card asserts is in the card.
//
//   3. EMPTY IS NOT ONE THING. "Nobody noticed anything this week" and "the
//      observation log has never been used" look identical on a page and mean
//      opposite things (§3.6). Every section says which kind of empty it is, or
//      is left out entirely. A heading with nothing under it is the worst of
//      the three, because it teaches people to skip the section.
import { all, one } from '../core/db.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from '../core/db.mjs';
import { humanObservedSql } from '../core/provenance.mjs';
import { groundToday } from './ground.mjs';
import { whatMoved, intakePromise } from './loops.mjs';
import { whatsNext } from './operator.mjs';
import { attributionFor, source as registrySource } from '../adapters/registry.mjs';

// Not a schema column: when a card was last produced is a fact about this
// computer, not about the commons, and it must never travel to another chapter.
const MARK = join(ROOT, 'data', 'last-card.json');

/**
 * The weekly card.
 *
 * Returns structured `sections` (for the canvas renderer) and a `text` block
 * that is what actually gets pasted — text survives pasting, stays searchable in
 * the chat afterwards, and is readable by a screen reader. The image is for a
 * noticeboard.
 */
export async function cardForTheWeek(chapterId, { days = 7 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };
  const chapter = one('SELECT * FROM chapters WHERE id=?', chapterId);
  if (!chapter) return { error: 'no_chapter' };

  const ground = await groundToday(chapterId).catch(() => null);
  const sections = [];
  // Every source that actually contributed a line to THIS card, by registry id.
  // Collected as the card is built rather than assumed afterwards, so a card
  // that had no weather does not credit a weather service.
  const used = new Set();

  // ── 1. The land. The part nobody else in that chat can produce. ──────────
  if (ground && !ground.error) {
    const body = [ground.headline];
    const w = ground.water;
    if (w?.years_of_record && !/\d+ years of record/.test(ground.headline)) {
      // When the reading IS the standing ("dry"), the standing already says it.
      const val = w.current === 0 ? 'dry' : `${fmt(w.current)} ${unit(w.unit)}`;
      const said = w.standing
        ? (w.standing.startsWith(val) ? w.standing : `${val} — ${w.standing}`)
        : val;
      body.push(`${w.site_name}: ${said}`);
    }
    if (ground.sky?.daylight) {
      body.push(`${ground.sky.daylight} of daylight, ${ground.sky.daylight_change}.`);
    }
    // A place can be heard, and almost none of it can be redistributed: nearly
    // every recording iNaturalist holds is NonCommercial. So the card carries
    // the FACT — a count and a name and a date — and never a file. The adapter
    // marks its own block export_safe:false, and this is the boundary where
    // that is checked rather than assumed.
    const heard = await soundFact(ground.place);
    if (heard) body.push(heard);

    if (ground.weather?.source_id) used.add(ground.weather.source_id);
    if (ground.water?.source_id) used.add(ground.water.source_id);
    if (heard && ground.heard?.source_id) used.add(ground.heard.source_id);

    sections.push({ id: 'land', label: ground.place.name, lines: body.filter(Boolean) });
  }

  // ── 2. What moved, and who moved it. ────────────────────────────────────
  const moved = whatMoved(chapterId, { since_days: days, limit: 2 });
  const everObserved = one(
    `SELECT COUNT(*) n FROM signals WHERE chapter_id=? AND ${humanObservedSql('source_adapter')}`,
    chapterId)?.n ?? 0;
  if (moved.items?.length) {
    sections.push({ id: 'moved', label: 'Because of what people noticed',
                    lines: moved.items.map((i) => i.sentence) });
  } else if (everObserved === 0) {
    // Never used is a different fact from nothing this week, and it is the one
    // a reader can actually do something about.
    sections.push({ id: 'moved', label: 'Nobody has written down an observation yet',
                    lines: ['If you see something at the creek this week, it can go in.'], empty: 'never' });
  }
  // Observations exist but nothing moved this week: say nothing. An empty
  // heading would read as a failure when it is an ordinary quiet week.

  // ── 3. The next gathering, with the care spelled out. ────────────────────
  const g = one(
    `SELECT * FROM gatherings WHERE chapter_id=? AND starts_at IS NOT NULL
       AND date(starts_at) >= date('now') ORDER BY starts_at LIMIT 1`, chapterId);
  if (g) {
    const care = [
      g.care_meals && 'food', g.care_transport && 'a lift',
      g.care_childcare && 'childcare', g.care_accessibility && 'step-free access',
    ].filter(Boolean);
    sections.push({
      id: 'gathering', label: 'Next gathering',
      lines: [
        `${g.title} — ${friendly(g.starts_at)}${g.location_name ? `, ${g.location_name}` : ''}`,
        care.length
          ? `There is ${list(care)}.`
          : 'No food, lift, childcare or step-free access arranged yet — which decides who can come.',
      ],
    });
  } else {
    sections.push({ id: 'gathering', label: 'Nothing in the diary',
                    lines: ['No gathering is scheduled. Momentum is hard to keep with no meeting.'],
                    empty: 'none_scheduled' });
  }

  // ── 4. One ask, pointed outward. ────────────────────────────────────────
  // The digest shape that works ends in a single unanswered question (§3.3),
  // and it has to be answerable by somebody who is not the steward.
  const ask = outwardAsk(chapterId);
  if (ask) sections.push({ id: 'ask', label: 'One thing anybody could do', lines: [ask.text], ask });

  // The seeded commons reads like real reporting — a Critical signal describing
  // an unpermitted stormwater discharge, naming a real creek and a real city
  // department. That is fine on a screen carrying the "example data" banner. It
  // is not fine in a card, because a card leaves the machine and arrives in a
  // group chat with none of that context around it.
  //
  // Same rule as attribution: an artifact that travels must declare what it is.
  const isExample = chapterId === 'barton-creek'
    && !!one(`SELECT 1 FROM signals WHERE chapter_id=? AND title='Unpermitted Stormwater Outfall Discharge'`, chapterId);

  const card = {
    chapter: chapter.name,
    is_example: isExample,
    generated_at: new Date().toISOString(),
    week_of: friendlyDate(new Date()),
    sections,
    // No sound, no photographs, no attachments: everything here leaves the
    // machine, and almost all the media this OS can reach is CC-BY-NC, which
    // this project does not redistribute (docs/SOCIAL_LAYER.md §3.7).
    contains_media: false,
    ...credits([...used]),
  };
  card.text = asText(card);
  return card;
}

/**
 * May this sentence leave the machine?
 *
 * The invariant is about what TRAVELS, not about what an adapter holds. A
 * culture or life block carries media metadata by design and is correctly
 * marked `export_safe: false`; only the one sentence goes on a card. So the
 * check is that the sentence carries no address to anything — nearly every
 * recording this OS can reach is NonCommercial, and a card is redistribution.
 *
 * Exported, and tested by breaking it, because an inline regex in a function
 * that needs the network to run is a guard nothing can prove.
 */
export function safeToSend(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return !/(https?:\/\/|www\.|\bdata:)/i.test(text);
}

/**
 * One line about what has been heard here — or nothing at all.
 * Loaded lazily so a card still writes itself if the culture adapter is absent,
 * and guarded so that a block which ever becomes export-safe-false in a
 * different way than expected simply drops out rather than travelling.
 */
async function soundFact(place) {
  if (place?.lat == null) return null;
  try {
    const { soundsHere } = await import('../adapters/culture.mjs');
    const s = await soundsHere(place.lat, place.lng, { radiusKm: 15 });
    if (!s?.available || typeof s.card_fact !== 'string') return null;
    return safeToSend(s.card_fact) ? s.card_fact : null;
  } catch { return null; }
}

/** The ask, in preference order: a person waiting, then the protocol's own gap. */
function outwardAsk(chapterId) {
  const intake = intakePromise(chapterId);
  if (intake.oldest_unanswered) {
    const o = intake.oldest_unanswered;
    return {
      kind: 'intake',
      text: `${o.from} brought something ${o.days} day${o.days === 1 ? '' : 's'} ago and has had no answer: ` +
            `“${o.body}” — does anyone know enough to reply?`,
      rule: intake.rule,
    };
  }
  const next = whatsNext(chapterId);
  // Two different criteria: the most urgent thing, and the most urgent thing
  // somebody can actually pick up. A `??` between them would sometimes put an
  // unactionable item under a heading that promises anybody could do it, with
  // nothing in the output to say which had happened. So the answer carries it.
  const actionable = next?.items?.find((i) => i.action) ?? null;
  const first = actionable ?? next?.first;
  if (!first) return null;
  return {
    kind: first.kind,
    actionable: !!actionable,
    // Phrased as a request rather than as a task on somebody's list — and the
    // detail is only carried when it survives as a whole sentence. A blob cut
    // off mid-word reads as a broken machine, which is the opposite of an
    // invitation.
    text: `${first.title}${sentence(first.detail)} ` +
          (actionable ? 'Anyone who can help with this, say so.'
                      : 'Nobody can act on this until somebody decides who owns it.'),
    rule: first.rule,
  };
}

/**
 * Credit for whatever actually fed this card.
 *
 * A card is not a screen. It is pasted into a group chat and forwarded, and it
 * is already in somebody else's hands by the time anyone checks it. For a
 * CC-BY source — Open-Meteo is one, and it is the weather everywhere outside
 * US National Weather Service coverage — attribution is not tidiness, it is
 * the condition of being allowed to share it at all.
 *
 * Anything the registry cannot resolve is NAMED rather than dropped. A card
 * missing one credit is otherwise indistinguishable from a card that needed
 * none, which is the shape this project keeps finding: absence reading as a
 * clean result.
 */
export function credits(ids) {
  if (!ids.length) return { credit: null, sources: [], unresolved_sources: [] };
  // Asked per id. attributionFor() returns no id on its rows, so deriving
  // "unresolved" from its output gave an empty set every time — a guard that
  // could never fire, which is worse than no guard because it looks like one.
  const unresolved = ids.filter((i) => !registrySource(i));
  const names = attributionFor(ids.filter((i) => registrySource(i)))
    .map((r) => r.attribution || r.source).filter(Boolean);
  return {
    sources: attributionFor(ids.filter((i) => registrySource(i))),
    unresolved_sources: unresolved,
    credit: [
      names.length ? names.join(' · ') : null,
      unresolved.length ? `Also drawn from: ${unresolved.join(', ')} — check their terms before sharing further.` : null,
    ].filter(Boolean).join(' '),
  };
}

/** The paste-ready block. Plain text, no markdown — chat apps mangle it. */
function asText(card) {
  const out = [`${card.chapter} — ${card.week_of}`, ''];
  for (const s of card.sections) {
    out.push(s.label.toUpperCase());
    for (const l of s.lines) out.push(l);
    out.push('');
  }
  out.push('Written from our own records. Nothing here is on the internet.');
  if (card.is_example) {
    out.push('DEMONSTRATION DATA — a fictional commons used to show how this works. ' +
             'Nothing above is a real observation, and no real organisation is involved.');
  }
  if (card.credit) out.push(card.credit);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── when the card was last produced ───────────────────────────────────────

export function markCardSent(chapterId) {
  try {
    mkdirSync(dirname(MARK), { recursive: true });
    const all = existsSync(MARK) ? JSON.parse(readFileSync(MARK, 'utf8')) : {};
    all[chapterId] = new Date().toISOString();
    writeFileSync(MARK, JSON.stringify(all, null, 2));
    return { marked: all[chapterId] };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Days since a card was last produced, or null if never.
 * The operator turns a long silence into an item in the round — never into a
 * notification. Nothing here nags.
 */
export function daysSinceLastCard(chapterId) {
  try {
    if (!existsSync(MARK)) return null;
    const at = JSON.parse(readFileSync(MARK, 'utf8'))[chapterId];
    if (!at) return null;
    return Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  } catch { return null; }
}

/** A detail rendered only if it is a whole sentence; nothing if it was truncated. */
function sentence(detail) {
  const d = String(detail ?? '').trim();
  if (!d || d.endsWith('…')) return '.';
  const first = d.split(/(?<=[.!?])\s/)[0].trim();
  return first && first.length <= 140 ? `. ${first}` : '.';
}

const fmt = (n) => (n == null ? '' : n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));
const unit = (u) => (u ?? '').replace('ft3/s', 'ft\u00B3/s');
const list = (a) => (a.length <= 1 ? a[0] ?? '' : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
function friendlyDate(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}
function friendly(ts) {
  try {
    const d = new Date(String(ts).replace(' ', 'T'));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
           (/\d\d:\d\d/.test(String(ts)) ? `, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '');
  } catch { return String(ts); }
}
