// ── The round ─────────────────────────────────────────────────────────────
// §4 of docs/DAILY_USE.md: the WEEK clock. Twenty minutes, the steward, and
// the reward is written down as "the list empties".
//
// It did not empty. `whats_next()` was recomputed on every look and the board
// took the top five by priority, so the list was a live ranking wearing a
// list's clothes. Measured by walking it: a steward closed a consent gate for
// real — door-knocked fourteen houses, wrote the evidence, named the reviewer —
// and afterwards the total was the same, the first item was the same, and the
// five lines were identical but for one digit. The next identical line had
// stepped into the slot.
//
// That is worse than a long list. A long list is discouraging; a list that does
// not change teaches a steward that their work does not move the screen, and
// there is no version of "try again next week" that survives learning it twice.
//
// So: the round is PICKED ONCE and HELD for the week. Clearing one empties a
// slot. When the five are gone, the screen says so.
//
// Three rules that keep this from becoming the thing §3.4 refuses:
//
//   Nothing is marked done by a person. An item leaves the round when it is no
//   longer in `whats_next()` — when the WORK is done, not when somebody says it
//   is. There is no checkbox to tick, nothing to game, and no way for the round
//   to disagree with the commons.
//
//   No counter survives the week. `closed_at` exists so a week can end, not so
//   weeks can be compared. Nothing reads a closed round back, nothing counts
//   finished rounds, and there is a test asserting it stays that way — "rounds
//   completed" is a streak with a calendar on it.
//
//   Urgent work is never hidden to protect the shape. Something BLOCKING that
//   arrives on Tuesday is shown beside the round, named as not being part of
//   it, rather than waiting six days for a slot.
import { all, one, run } from '../core/db.mjs';
import { newId } from '../core/ids.mjs';
import { whatsNext } from './operator.mjs';
import { parseStamp } from '../core/time.mjs';

/** How long a round is. A week, because the clock this serves is the week. */
export const ROUND_DAYS = 7;

/**
 * A key that survives the work being done to it.
 *
 * Items are recomputed every call and carry no id, so holding five of them
 * means being able to recognise the same piece of work twice. Titles cannot do
 * it — "2 projects are waiting on gates — 17 between them" changes the moment a
 * gate closes, which is precisely when the round must NOT lose track of it.
 *
 * So: the stage, the tool, and the ids the action names — with the volatile
 * inputs left out. `gate` is the clearest of them: the action offers whichever
 * gate is open first, and closing that one would otherwise make the item look
 * like a different item and silently empty a slot that still has work in it.
 */
const VOLATILE = new Set(['gate', 'title', 'days', 'actions', 'projects', 'reason']);

export function itemKey(item) {
  const a = item?.action ?? {};
  const ids = Object.entries(a.input ?? {})
    .filter(([k, v]) => !VOLATILE.has(k) && v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return [item?.stage ?? '?', a.tool ?? 'none', ...ids].join('|');
}

const parseList = (s) => { try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** The open round, if one is open and still this week. */
function openRound(chapterId) {
  // Tiebreak on rowid: opened_at is a DATE, two rounds opened in the same
  // second sort arbitrarily without one, and this project has been bitten by
  // exactly that before.
  const r = one(
    `SELECT * FROM rounds WHERE chapter_id=? AND closed_at IS NULL
      ORDER BY opened_at DESC, rowid DESC LIMIT 1`, chapterId);
  if (!r) return null;
  const opened = parseStamp(r.opened_at);
  if (!opened) return r;                       // unreadable stamp: keep it rather than churn
  const age = (Date.now() - opened.getTime()) / 86400000;
  if (age < ROUND_DAYS) return r;
  run(`UPDATE rounds SET closed_at=datetime('now') WHERE id=?`, r.id);
  return null;
}

/**
 * This week's round.
 *
 * Read-only unless there is no open round, in which case it opens one. That is
 * the only write, and it is what makes the round a thing that exists rather
 * than a query that happens to return five rows.
 */
export function theRound(chapterId, { size = 5 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };

  const next = whatsNext(chapterId);
  if (next?.error) return next;
  const live = (next.items ?? []).filter((i) => i.action);
  const byKey = new Map(live.map((i) => [itemKey(i), i]));

  let r = openRound(chapterId);
  if (!r) {
    const picked = live.slice(0, size).map(itemKey);
    const id = newId('rnd');
    run(`INSERT INTO rounds (id, chapter_id, picked) VALUES (?,?,?)`,
      id, chapterId, JSON.stringify(picked));
    r = one('SELECT * FROM rounds WHERE id=?', id);
  }

  const picked = parseList(r.picked);
  const aside = parseList(r.set_aside);
  const asideKeys = new Set(aside.map((a) => a.key));

  // Still to do: picked, still live, not set aside. Order follows the live
  // ranking rather than the order they were picked in — within a round, what is
  // most urgent today is still what is most urgent today.
  const remaining = live.filter((i) => {
    const k = itemKey(i);
    return picked.includes(k) && !asideKeys.has(k);
  });

  // Gone because the work is done. Not "completed by" anybody — this is simply
  // the difference between what was picked and what is still on the list.
  const done = picked.filter((k) => !byKey.has(k) && !asideKeys.has(k));

  // Something blocking that was not in the round. Named rather than folded in,
  // so an emergency on Tuesday is not hidden for six days and the five are
  // still five.
  const arrived = live.filter((i) => i.kind === 'blocking' && !picked.includes(itemKey(i)));

  return {
    round_id: r.id,
    opened_at: r.opened_at,
    size: picked.length,
    remaining,
    remaining_count: remaining.length,
    done_count: done.length,
    set_aside: aside,
    finished: remaining.length === 0,
    // What did not fit. Stated, never refilled from — the whole point is that
    // the round does not grow back.
    waiting_count: Math.max(0, live.length - picked.length - arrived.length),
    not_in_this_round: arrived,
    // One sentence, because this is the answer to "am I done".
    sentence: remaining.length === 0
      ? (picked.length === 0
        ? 'Nothing needed doing this week.'
        : 'That is the round. Nothing else is asked of you this week.')
      : `${remaining.length} left in this week's round.`,
  };
}

/**
 * Not this week.
 *
 * The spec asks for the round to be "deferrable" and it is the half that makes
 * finishing honest: without it, one thing a steward cannot do this week holds
 * the round open forever and the finish state becomes unreachable, which is the
 * original problem with an extra step.
 *
 * It takes a reason and keeps it. Setting something aside is a decision a
 * commons made, and a decision with no reason recorded is indistinguishable
 * next month from nobody having noticed.
 */
export function setAside(chapterId, key, reason) {
  if (!chapterId) return { error: 'no_chapter' };
  if (!String(key ?? '').trim()) {
    return { error: 'missing_required', message: 'Which item is being set aside.' };
  }
  if (!String(reason ?? '').trim()) {
    return {
      error: 'no_reason',
      message: 'Say why it is not this week. A month from now, "set aside" with no reason '
        + 'reads exactly like nobody having looked.',
    };
  }
  const r = openRound(chapterId);
  if (!r) return { error: 'no_round', message: 'There is no round open to set anything aside from.' };

  const picked = parseList(r.picked);
  if (!picked.includes(key)) {
    return { error: 'not_in_round', message: 'That is not one of the things this round asked for.' };
  }
  const aside = parseList(r.set_aside);
  if (aside.some((a) => a.key === key)) return { already: true, ...theRound(chapterId) };

  aside.push({ key, reason: String(reason).trim(), at: new Date().toISOString() });
  run(`UPDATE rounds SET set_aside=? WHERE id=?`, JSON.stringify(aside), r.id);
  return theRound(chapterId);
}
