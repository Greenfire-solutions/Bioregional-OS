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
import { myRegions, brief as regionBrief } from './library.mjs';

export function board(chapterId, { actions = 5, projects = 8 } = {}) {
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
  const l4 = regions.level4?.[0] ?? null;
  const region = l4 ? safely(() => regionBrief(l4.code)) : null;

  // ── What can I do ───────────────────────────────────────────────────────
  // The operator already ranks everything by what blocks other work. The board
  // takes only the top few, because a list of thirty things is a list nobody
  // starts. The rest stays one click away rather than being hidden.
  const next = safely(() => whatsNext(chapterId)) ?? { items: [], total: 0 };
  const doable = (next.items ?? []).filter((i) => i.action);
  const todo = doable.slice(0, actions).map((i) => ({
    title: i.title, detail: i.detail ?? null, why: i.rule ?? null,
    urgency: i.kind, stage: i.stage, action: i.action, age_days: i.age_days ?? null,
  }));

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
      ecoregion: l4 ? { code: l4.code, name: l4.name, biome: l4.biome, level3: l4.level3_name } : null,
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
    todo_total: doable.length,
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
