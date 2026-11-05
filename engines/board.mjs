// ── The board ─────────────────────────────────────────────────────────────
// One screen that answers the four questions a person actually arrives with,
// in the order they arrive with them:
//
//   Where am I?        the ground, and what it is doing right now
//   What is going on?  the projects, and what state each is really in
//   Who is here?       the people, and what they are carrying
//   What can I do?     a small number of things, each one click from done
//
// The interface this replaces at the front had fifteen tabs named after the
// protocol's stages — Listen, Signals, Quests, Convene, Measure. That is the
// SYSTEM's filing cabinet. It is a good filing cabinet and everything in it
// still exists; it is simply not what a person can navigate on arrival,
// because using it requires already knowing the twelve-stage loop. The person
// who designed this could not tell where to click, which is not a failure of
// attention — it is what a taxonomy built for completeness does to whoever has
// to stand in front of it.
//
// So: one composition, arranged by what a person is looking for rather than by
// which stage produced it. Nothing here is new information. Every field comes
// from an engine that already existed, and the tabs remain for the depth.
//
// ENTIRELY OFFLINE AND SYNCHRONOUS. This is the first paint of the first screen
// and it must never wait on a network call — everything is the local database
// plus solar equations computed on this machine. A board that hangs because an
// upstream is slow is a board nobody sees.
import { all, one } from '../core/db.mjs';
import { brief as landSeatBrief } from './landseat.mjs';
import { whatsNext } from './operator.mjs';
import { carrying } from './attention.mjs';
import { whoCouldHelp } from './matching.mjs';
import { priorities } from './quest.mjs';
import { myRegions, homeRegion, brief as regionBrief } from './library.mjs';
import { mayRun } from '../ai/access.mjs';
import { theRound, itemKey } from './round.mjs';
import { settledIn } from './firstrun.mjs';

export function board(chapterId, { actions = 5, projects = 8, clearance = null } = {}) {
  if (!chapterId) {
    return {
      error: 'no_chapter',
      message: 'No commons here yet. Find your bioregion first — it writes nothing and takes ' +
               'about seven seconds.',
      action: { tool: 'look_around', input: {} },
    };
  }
  const chapter = one('SELECT * FROM chapters WHERE id=?', chapterId);
  const land = safely(() => landSeatBrief(chapterId)) ?? {};
  const regions = safely(() => myRegions(chapterId)) ?? {};
  // myRegions() is the DOWNLOAD list — every region whose bounding box overlaps
  // this chapter. Taking [0] from it made the header name the wrong ecoregion
  // for essentially every chapter that is not the demo. homeRegion() asks the
  // question the header is actually asking, and answers it from the EPA polygon
  // already stored on the place row.
  const l4 = safely(() => homeRegion(chapterId)) ?? null;
  const region = l4?.code ? safely(() => regionBrief(l4.code)) : null;

  // ── What can I do ───────────────────────────────────────────────────────
  // The operator already ranks everything by what blocks other work. The board
  // takes only the top few, because a list of thirty things is a list nobody
  // starts. The rest stays one click away rather than being hidden.
  const next = safely(() => whatsNext(chapterId)) ?? { items: [], total: 0 };
  // Five things this connection can actually do.
  //
  // The board used to take the top five by priority and hand them over
  // regardless of who was looking, so a newly enrolled member's first screen
  // offered: start a project (works), close a gate (council), close a gate
  // (council), resolve the flag (council), locate it (works). And
  // `satisfy_quest_gate` is not a direct action, so the refusal arrived AFTER
  // she had opened the form and typed a paragraph of evidence and a reviewer's
  // name into it. Member is the default role in the invite dropdown, so that is
  // the ordinary path, not an edge.
  //
  // Filtered BEFORE the cap, so the slots refill with work she can do rather
  // than showing her three things and two gaps. The items themselves are not
  // hidden — the count below says how many are held, and every one of them is
  // still in `whats_next`, which she can read. A commons that concealed its own
  // council work from its members would be a worse answer than one that offered
  // it and refused.
  const runnable = (i) => clearance == null || mayRun(i.action.tool, clearance);
  const withActions = (next.items ?? []).filter((i) => i.action);
  const doable = withActions.filter(runnable);
  const forOthers = withActions.length - doable.length;
  // Settling in comes first, always, until it is done. An installed commons
  // with nothing in it is the way these die (docs/COMMUNICATIONS.md), so the
  // three things that make it about somewhere and someone are not a wizard
  // that can be dismissed — they are the top of the list until they exist.
  const settling = safely(() => settledIn(chapterId)) ?? { complete: true, steps: [] };
  const settle = settling.complete ? [] : settling.steps.filter((s) => !s.done).map((s) => ({
    title: s.title, detail: s.detail, why: s.why,
    urgency: 'gap', stage: 'Settling in', action: s.action, age_days: null,
  }));
  // ── This week's round, not the top five of a live ranking ───────────────
  //
  // The board used to take the top five every time it was asked, so closing a
  // gate moved a digit and the next identical line stepped into the slot: the
  // five lines were the same next week, and the week after. A round is picked
  // once and held (engines/round.mjs), so clearing one EMPTIES a slot.
  //
  // Settling in still comes first and still sits inside the cap. It is not part
  // of the round because it is not weekly work — it is the three things that
  // make a commons about somewhere and someone, and until they exist there is
  // nothing for a round to be about.
  const week = settling.complete
    ? (safely(() => theRound(chapterId, { size: actions })) ?? null)
    : null;
  const fromRound = (week?.remaining ?? doable).filter(runnable);
  const todo = [...settle, ...fromRound.slice(0, Math.max(0, actions - settle.length)).map((i) => ({
    title: i.title, detail: i.detail ?? null, why: i.rule ?? null,
    urgency: i.kind, stage: i.stage, action: i.action, age_days: i.age_days ?? null,
    key: itemKey(i),
  }))];

  // ── What is going on ────────────────────────────────────────────────────
  // A project card has to say what state it is really in, which is not its
  // stage — a project can sit at "co-design" for a season with nothing
  // blocking it, or at "prototype" with four gates open. So each carries what
  // is actually in its way.
  const pri = safely(() => priorities(chapterId)) ?? { ranked: [], blocked: [] };
  const scoreOf = new Map([...(pri.ranked ?? []), ...(pri.blocked ?? [])].map((p) => [p.id, p]));
  const quests = all(
    `SELECT q.id, q.title, q.stage, q.status, q.maintenance_owner, q.category,
            p.name place, p.ecoregion_name, p.watershed_name
       FROM quests q LEFT JOIN places p ON p.id = q.place_id
      WHERE q.chapter_id = ? AND q.status NOT IN ('Complete','Stopped')
      ORDER BY q.created_at DESC LIMIT ?`, chapterId, projects)
    .map((q) => {
      const s = scoreOf.get(q.id);
      return {
        id: q.id, title: q.title, stage: q.stage, status: q.status,
        owner: q.maintenance_owner || null,
        place: q.place || null,
        ground: [q.watershed_name, q.ecoregion_name].filter(Boolean).join(' · ') || null,
        blocking: s?.blocked ?? [],
        score: s?.overall ?? null,
        weakest: s?.overall != null ? s.weakest : null,
        // Said once, here, so every card can show the same sentence rather than
        // each part of the interface inventing its own phrasing for "stuck".
        state: s?.blocked?.length
          ? `${s.blocked.length} thing${s.blocked.length === 1 ? '' : 's'} in the way`
          : 'nothing blocking it',
      };
    });

  const finished = one(
    `SELECT COUNT(*) n FROM quests WHERE chapter_id=? AND status='Complete'`, chapterId)?.n ?? 0;

  // ── Who is here ─────────────────────────────────────────────────────────
  const care = safely(() => carrying(chapterId)) ?? { people: [] };
  const help = safely(() => whoCouldHelp(chapterId, { limit: 4 })) ?? { needs: [] };
  const asked = (help.needs ?? [])
    .filter((n) => n.from_here.length || n.from_nearby.length)
    .slice(0, 3)
    .map((n) => ({
      need: n.text, kind: n.kind,
      could: [...n.from_here.map((c) => ({ who: c.who, where: 'here', on: c.on })),
              ...n.from_nearby.map((c) => ({ who: c.who, where: 'nearby', on: c.on, url: c.url }))]
        .slice(0, 3),
    }));

  // ── Around you ──────────────────────────────────────────────────────────
  const peers = all(
    `SELECT name, url, kind, summary FROM federation_peers
      WHERE summary IS NOT NULL AND status IN ('known','connected','sharing') LIMIT 5`);

  return {
    here: {
      chapter: chapter?.name ?? chapterId,
      scale: chapter?.scale ?? null,
      steward: chapter?.steward ?? null,
      deputy: chapter?.deputy ?? null,
      place: land.place?.name ?? null,
      places: all('SELECT id, name, lat, lng FROM places WHERE chapter_id=?', chapterId),
      ecoregion: l4
        ? { code: l4.code, name: l4.name, biome: l4.biome, level3: l4.level3_name, basis: l4.basis }
        : null,
      watershed: land.watershed ?? null,
      region_downloaded: !!region?.downloaded,
      now: {
        water: land.water?.reading ?? null,
        water_stale: !!land.water?.stale,
        hazards: dedupe(land.hazards ?? []),
        season: land.season?.next_turn ?? null,
        daylight: land.season?.change_per_day ?? null,
      },
      sentence: land.sentence ?? null,
    },
    todo,
    // How much of THIS WEEK is left, once a round exists — not how much work the
    // commons has, which is `round.waiting`. Before a commons has settled in
    // there is no round, and this keeps its original meaning so the "5 of 45,
    // the rest are on Today" note still has something true to say.
    todo_total: fromRound.length + settle.length,
    // The week, said in a sentence. `finished` is a state the software can be
    // in — which is what makes this a round rather than a list — and it is
    // deliberately NOT a score: nothing counts finished weeks or compares one
    // to another. See the note on the rounds table.
    round: week ? {
      finished: week.finished && settle.length === 0,
      sentence: settle.length ? null : week.sentence,
      remaining: week.remaining_count,
      done: week.done_count,
      set_aside: week.set_aside.length,
      opened_at: week.opened_at,
      // Something blocking that arrived after the round was picked. Shown
      // beside it, never folded into it, so an emergency on Tuesday is not
      // hidden for six days and the five are still five.
      arrived_since: (week.not_in_this_round ?? []).filter(runnable).slice(0, 2).map((i) => ({
        title: i.title, stage: i.stage, action: i.action, key: itemKey(i),
      })),
      waiting: week.waiting_count,
    } : null,
    // Held back because this connection may not run them, not hidden. Zero at
    // the keyboard. The interface says so in a line rather than leaving a
    // member to wonder why their board is shorter than the steward's.
    for_the_council: forOthers,
    settling,
    blocked_count: (next.items ?? []).filter((i) => i.kind === 'blocking').length,
    projects: quests,
    projects_finished: finished,
    people: (care.people ?? []).map((p) => ({
      name: p.name, holding: p.holding, is_organisation: p.is_organisation,
      longest_held_days: p.longest_held_days,
      overloaded: (care.overloaded ?? []).includes(p.name),
    })),
    could_help: asked,
    around: {
      within_reach: region?.downloaded ? oneLine(region.resources) : null,
      life: region?.downloaded ? region.life ?? null : null,
      neighbours: peers.map((p) => ({
        name: p.name, url: p.url, is_chapter: p.kind === 'chapter',
        line: truncate(p.summary, 90),
      })),
    },
    // The one line at the top. Deliberately about the LAND when the land has
    // something to say, because the whole argument of this project is that a
    // page which only ever hands you your own debts does not get opened twice.
    headline: land.sentence
      ?? `${chapter?.name ?? 'This commons'} — nothing recorded about the ground yet.`,
  };
}

function dedupe(hazards) {
  return [...new Map(hazards.map((h) => [h.title, { severity: h.severity, title: h.title }])).values()]
    .slice(0, 3);
}
function oneLine(section) {
  if (!section) return null;
  if (typeof section === 'string') return section;
  return section.readable ?? section.sentence ?? section.summary ?? null;
}
function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function safely(fn) {
  try { const r = fn(); return r?.error ? null : r; } catch { return null; }
}
