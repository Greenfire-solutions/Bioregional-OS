// ── Who could help, and who needs what you can do ─────────────────────────
// The manual lists "skill matching" among the things AI may assist with, and
// lists "who deserves care", "project legitimacy" and "membership worth" among
// the things it may not decide. This file lives exactly on that line, so the
// line is drawn in the code rather than left to a prompt:
//
//   It SURFACES candidates. It never introduces anybody, never ranks a person,
//   and never says a match is a match. The output is a list of things somebody
//   might usefully ask another person about, and the asking is theirs.
//
// The other half of the design is where the evidence comes from. Nobody is
// asked to fill in a skills profile — a self-declared skill list is a document
// that is accurate on the day it is written and wrong within a season, and the
// people least likely to fill one in are the ones already doing the most. So a
// person's skills here are READ FROM WHAT THEY HAVE ALREADY DONE: work they
// were recorded providing, gates they reviewed, indicators they read. That is
// evidence rather than aspiration, and it costs nobody a form.
//
// The same rule as everywhere else in this project applies to the private half:
// an intake item marked private never leaves the Listen tab, because somebody
// marked it private for a reason and a match is a disclosure.
import { all, one } from '../core/db.mjs';
import { normalise } from './attention.mjs';

/** Words too common to mean anything when two texts share them. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were',
  'our', 'their', 'its', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'is', 'it', 'be',
  'we', 'they', 'you', 'i', 'as', 'or', 'but', 'not', 'can', 'will', 'would', 'need', 'needs',
  'project', 'projects', 'community', 'local', 'work', 'working', 'help', 'people', 'new',
]);

export function whoCouldHelp(chapterId, { limit = 8 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };

  // ── What this commons is actually short of ─────────────────────────────
  const needs = [];

  // A need somebody brought and nobody has answered. PRIVATE ITEMS EXCLUDED —
  // a private need is private from the matcher too, and this is the one place
  // where forgetting that would publish somebody's circumstances as a task.
  for (const r of all(
    `SELECT id, body, submitted_by FROM intake
      WHERE chapter_id = ? AND status = 'received' AND private = 0
      ORDER BY created_at`, chapterId)) {
    needs.push({ kind: 'need brought', id: r.id, text: r.body, from: r.submitted_by ?? null });
  }

  // A project with nobody named to keep it alive. The protocol's own gate.
  for (const q of all(
    `SELECT id, title, description, category FROM quests
      WHERE chapter_id = ? AND status IN ('Open','Active')
        AND (maintenance_owner IS NULL OR trim(maintenance_owner) = '')`, chapterId)) {
    needs.push({ kind: 'project with no maintenance owner', id: q.id,
                 text: `${q.title}. ${q.description ?? ''}`.trim(), from: null });
  }

  // A gate nobody has reviewed. These are the most concretely askable of all —
  // each one names a specific competence somebody has to bring.
  for (const g of all(
    `SELECT g.id, g.gate, q.title, q.id quest_id FROM quest_gates g
       JOIN quests q ON q.id = g.quest_id
      WHERE q.chapter_id = ? AND q.status IN ('Open','Active')
        AND g.required = 1 AND g.satisfied = 0`, chapterId)) {
    needs.push({ kind: 'gate needing a reviewer', id: g.id,
                 text: `${g.gate.replace(/_/g, ' ')} for ${g.title}`, from: null,
                 quest_id: g.quest_id, gate: g.gate });
  }

  // An indicator on a cadence that nobody has ever read.
  for (const i of all(
    `SELECT i.id, i.name, i.method, q.title FROM indicators i
       JOIN quests q ON q.id = i.quest_id
      WHERE i.chapter_id = ? AND i.cadence IS NOT NULL AND trim(i.cadence) <> ''
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.indicator_id = i.id)`, chapterId)) {
    needs.push({ kind: 'measurement nobody has taken', id: i.id,
                 text: `${i.name} — ${i.method ?? 'no method recorded'} (${i.title})`, from: null });
  }

  // ── What people here have demonstrably done ────────────────────────────
  const people = new Map();
  const note = (name, what) => {
    const key = normalise(name);
    if (!key) return;
    if (!people.has(key)) people.set(key, { name: String(name).trim(), done: [] });
    people.get(key).done.push(what);
  };

  for (const e of all(
    `SELECT a.name, e.resource_name, e.note FROM exchange_events e
       JOIN agents a ON a.id = e.provider_id
      WHERE e.chapter_id = ? AND e.vf_action = 'work'`, chapterId)) {
    note(e.name, e.resource_name || e.note || 'work recorded');
  }
  for (const g of all(
    `SELECT g.reviewed_by, g.gate FROM quest_gates g JOIN quests q ON q.id = g.quest_id
      WHERE q.chapter_id = ? AND g.satisfied = 1 AND g.reviewed_by IS NOT NULL`, chapterId)) {
    note(g.reviewed_by, `reviewed a ${g.gate.replace(/_/g, ' ')} gate`);
  }
  for (const m of all(
    `SELECT m.measured_by, i.name FROM measurements m JOIN indicators i ON i.id = m.indicator_id
      WHERE i.chapter_id = ? AND m.measured_by IS NOT NULL AND trim(m.measured_by) <> ''`, chapterId)) {
    note(m.measured_by, `read ${m.name}`);
  }
  for (const s of all(
    `SELECT author, category FROM signals
      WHERE chapter_id = ? AND author IS NOT NULL AND trim(author) <> ''
        AND source_adapter IN ('manual','notice','assistant','comapeo','geojson')`, chapterId)) {
    note(s.author, `observes ${String(s.category ?? 'the place').toLowerCase()}`);
  }

  // ── Neighbours, as they described themselves ───────────────────────────
  const peers = all(
    `SELECT name, url, summary, kind FROM federation_peers
      WHERE summary IS NOT NULL AND status IN ('known','connected','sharing')`);

  // ── The join. Word overlap, and deliberately nothing cleverer ──────────
  // A similarity score here would be a number nobody can argue with, attached
  // to a suggestion about a person. Shared words can be checked by eye — the
  // answer says WHICH words matched, so a steward can see instantly that
  // "bank" matched a river bank to a savings bank and ignore it.
  const matched = needs.slice(0, limit).map((n) => {
    const words = terms(n.text);
    const from_here = [...people.values()]
      .map((p) => ({ who: p.name, on: overlap(words, terms(p.done.join(' '))), has_done: p.done.slice(0, 3) }))
      .filter((c) => c.on.length)
      .sort((a, b) => b.on.length - a.on.length).slice(0, 3);
    const from_nearby = peers
      .map((p) => ({ who: p.name, url: p.url, is_chapter: p.kind === 'chapter',
                     on: overlap(words, terms(p.summary)), says: truncate(p.summary, 110) }))
      .filter((c) => c.on.length)
      .sort((a, b) => b.on.length - a.on.length).slice(0, 3);
    return { ...n, from_here, from_nearby };
  });

  const withSomeone = matched.filter((m) => m.from_here.length || m.from_nearby.length);

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    needs: matched,
    total_needs: needs.length,
    people_known: people.size,
    neighbours_readable: peers.length,
    rule: 'AI may assist with skill matching. It may not decide who deserves care, whose work ' +
          'is legitimate, or who is a member.',
    caveat: 'These are candidates, not introductions. Nobody has been asked, nobody has agreed, ' +
            'and a shared word is not a shared skill — the matching words are shown so you can ' +
            'dismiss the ones that are coincidence.',
    sentence: !needs.length
      ? 'Nothing is currently waiting on a person here.'
      : !withSomeone.length
        ? `${needs.length} thing${needs.length === 1 ? '' : 's'} waiting on somebody, and nobody ` +
          'recorded here or nearby obviously matches. That is worth saying out loud at a gathering.'
        : `${withSomeone.length} of ${Math.min(needs.length, limit)} open needs have somebody ` +
          'here or nearby who has done something like it before.',
  };
}

/** Meaningful words, lowercased, de-duplicated. */
function terms(text) {
  return new Set(String(text ?? '').toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);
}

function overlap(a, b) {
  return [...a].filter((w) => b.has(w)).slice(0, 6);
}

function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
