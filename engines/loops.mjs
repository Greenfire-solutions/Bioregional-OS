// ── Closing the loops ─────────────────────────────────────────────────────
// The two questions the data already answers and the interface never asked.
//
// Across citizen science, the most consistently identified driver of continued
// participation is not recognition, not scoring and not reminders — it is
// seeing that what you contributed went somewhere. The matching finding on the
// other side is that slow or absent reporting of results is a leading cause of
// people stopping. The chain exists here already:
//
//   signals.id → quests.signal_id → decisions.quest_id → indicators → measurements
//                                 → quest_gates
//                                 → learn.quest_id
//
// Nobody who started that chain has ever been told about it.
//
// The hard constraint, and the reason core/provenance.mjs exists: every adapter
// writes into the same signals table. A naive version of this credits a person
// for a Heat Advisory that NOAA issued. Only human-observed signals are ever
// attributed to a human.
import { all, one, latestMeasurement } from '../core/db.mjs';
import { parseStamp } from '../core/time.mjs';
import { humanObservedSql } from '../core/provenance.mjs';

/**
 * Mechanic §5.4 — what a person's observations turned into.
 *
 * Read-only, and it never invents a connection: every item names the row that
 * links it, so somebody who disagrees can go and look.
 */
export function whatMoved(chapterId, { since_days = 90, limit = 12 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };

  const seeds = all(
    `SELECT s.id, s.title, s.author, s.category, s.severity,
            coalesce(s.observed_at, s.created_at) at
       FROM signals s
      WHERE s.chapter_id = ?
        AND ${humanObservedSql('s.source_adapter')}
        AND EXISTS (SELECT 1 FROM quests q WHERE q.signal_id = s.id)
      ORDER BY at DESC`, chapterId);

  const items = [];
  for (const s of seeds) {
    const quests = all(
      `SELECT id, title, stage, status, created_at FROM quests WHERE signal_id = ?`, s.id);
    const became = [];

    for (const q of quests) {
      became.push({
        kind: 'quest', id: q.id, title: q.title, at: q.created_at,
        detail: `now at the ${String(q.stage).replace(/_/g, ' ')} stage`,
      });

      for (const d of all(
        `SELECT id, title, status, method, decided_at, created_at
           FROM decisions WHERE quest_id = ? ORDER BY coalesce(decided_at, created_at)`, q.id)) {
        // `decided_at ?? created_at` would put two different dates — when the
        // council decided, and when somebody proposed it — into one field with
        // no way to tell them apart. They answer different questions, so the
        // answer says which one it is carrying.
        const decided = d.status === 'decided' && d.decided_at;
        became.push({
          kind: 'decision', id: d.id, title: d.title,
          at: decided ? d.decided_at : d.created_at,
          at_is: decided ? 'decided' : 'proposed',
          detail: decided
            ? `decided by ${String(d.method).replace(/_/g, ' ')}`
            : `proposed, still on the council agenda (${d.status})`,
        });
      }

      for (const g of all(
        `SELECT gate, reviewed_by, reviewed_at FROM quest_gates
          WHERE quest_id = ? AND satisfied = 1 AND reviewed_at IS NOT NULL
          ORDER BY reviewed_at`, q.id)) {
        became.push({
          kind: 'gate', title: String(g.gate).replace(/_/g, ' '), at: g.reviewed_at,
          detail: g.reviewed_by ? `cleared by ${g.reviewed_by}` : 'cleared',
        });
      }

      for (const m of all(
        `SELECT m.value, m.measured_at, m.measured_by, i.name, i.unit, i.target_value
           FROM measurements m JOIN indicators i ON i.id = m.indicator_id
          WHERE i.quest_id = ? ${latestMeasurement('m')} LIMIT 3`, q.id)) {
        became.push({
          kind: 'measurement', title: m.name, at: m.measured_at,
          detail: `${m.value}${m.unit ? ` ${m.unit}` : ''}` +
                  (m.target_value != null ? ` against a target of ${m.target_value}` : '') +
                  (m.measured_by ? `, read by ${m.measured_by}` : ''),
        });
      }

      for (const l of all(
        `SELECT id, title, kind, created_at FROM learn WHERE quest_id = ?`, q.id)) {
        became.push({
          kind: 'learning', id: l.id, title: l.title, at: l.created_at,
          detail: 'written up so it can travel to another chapter',
        });
      }
    }

    if (!became.length) continue;
    became.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const latest = became[became.length - 1].at;
    if (since_days && daysSince(latest) > since_days) continue;

    items.push({
      person: s.author?.trim() || null,
      signal: { id: s.id, title: s.title, at: s.at, category: s.category, severity: s.severity },
      became,
      latest_at: latest,
      // The sentence, built once here so the interface and the assistant say
      // the same thing about the same row.
      sentence: sentence(s, became),
    });
  }

  items.sort((a, b) => String(b.latest_at).localeCompare(String(a.latest_at)));

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    since_days,
    total: items.length,
    items: items.slice(0, limit),
    note: items.length ? null
      : 'Nothing a person observed has led anywhere yet. That is not a failure — it is what ' +
        'the Observe stage looks like before the Prioritize stage catches up.',
  };
}

function sentence(s, became) {
  const who = s.author?.trim() ? `${s.author}'s` : 'An';
  const when = String(s.at ?? '').slice(0, 10);
  const decision = became.find((b) => b.kind === 'decision');
  const learning = became.find((b) => b.kind === 'learning');
  const quest = became.find((b) => b.kind === 'quest');

  if (learning) {
    return `${who} observation on ${when} became ${quest?.title ?? 'a project'}, ` +
           `and what was learned has been written down so another place can use it.`;
  }
  if (decision) {
    // Reads the flag, not the prose. Testing /decided/ against a sentence this
    // same file writes means any rewording silently changes what the card says
    // happened — the string is for people, the field is for code.
    return `${who} observation on ${when} is why the council ${
      decision.at_is === 'decided' ? 'decided on' : 'is meeting about'} ${decision.title}.`;
  }
  return `${who} observation on ${when} became ${quest?.title ?? 'a project'}.`;
}

/**
 * Mechanic §5.5 — the intake promise, kept or not.
 *
 * The protocol says a person must be able to submit a need, receive a response,
 * and appeal. This measures the middle one. A visible promise kept is why
 * somebody trusts the thing enough to bring a second need; a promise quietly
 * broken is why they do not.
 */
export function intakePromise(chapterId) {
  if (!chapterId) return { error: 'no_chapter' };

  const rows = all(
    `SELECT id, kind, body, submitted_by, status, response, created_at
       FROM intake WHERE chapter_id = ? ORDER BY created_at`, chapterId);

  const answered = rows.filter((r) => r.status !== 'received' || (r.response ?? '').trim());
  const waiting = rows.filter((r) => !answered.includes(r));

  // Days to answer, for the ones that were answered. The database does not keep
  // a responded_at, so this is measured against now for anything still open and
  // reported separately rather than mixed in.
  const waits = waiting.map((r) => daysSince(r.created_at)).sort((a, b) => a - b);
  const longestWait = waits.length ? waits[waits.length - 1] : 0;

  return {
    brought: rows.length,
    answered: answered.length,
    waiting: waiting.length,
    longest_wait_days: longestWait,
    // The protocol's own threshold, so the number means something.
    overdue: waiting.filter((r) => daysSince(r.created_at) > 14).length,
    oldest_unanswered: waiting.length
      ? { id: waiting[0].id, from: waiting[0].submitted_by ?? 'Someone',
          days: daysSince(waiting[0].created_at), body: truncate(waiting[0].body, 140) }
      : null,
    rule: 'A person must be able to submit a need, receive a response, and appeal.',
    sentence: rows.length === 0
      ? 'Nobody has brought a need yet. The Listen tab is the front door — it is worth telling people it exists.'
      : waiting.length === 0
        ? `${rows.length} need${rows.length === 1 ? '' : 's'} brought. All of them answered.`
        : `${rows.length} brought, ${answered.length} answered. ` +
          `${waiting.length} still waiting — the longest for ${longestWait} day${longestWait === 1 ? '' : 's'}.`,
  };
}

function daysSince(ts) {
  if (!ts) return 0;
  const d = parseStamp(ts);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
