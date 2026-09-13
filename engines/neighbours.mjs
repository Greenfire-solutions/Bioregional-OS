// ── The neighbours ────────────────────────────────────────────────────────
// §5.12. Once a week, what the neighbours published — one line each.
//
// "Neighbours" rather than "chapters", and that wording is load-bearing. The
// Murmurations index answers a geographic query with every organisation near
// the point: asked around Austin it returns a taxi co-operative, a web host, a
// copywriting agency and an individual researcher. Only a peer whose OWN
// published tags claim to be a bioregional commons is counted as a chapter.
// Both are worth knowing about, they are not the same thing, and the panel
// says which is which — see classifyPeer() in adapters/murmurations.mjs.
//
// §3.3 is the reason it exists: belonging to something larger is what sustains
// volunteer groups, and a bioregional commons that believes it is the only one
// is a lonely and short-lived thing. §3.9 is the reason it looks the way it
// does: peripheral awareness, not a feed.
//
// The whole design problem is §3.6 — the Nextdoor failure mode. A list of what
// other people are doing, refreshed often enough, IS a feed, and a feed in a
// neighbourhood context reliably becomes a complaint engine. So four rules,
// and every one of them is a refusal:
//
//   WEEKLY, AND NOT ON OPENING. The data is fetched on a seven-day cadence by
//   the heartbeat. Opening the page shows what was already known. A panel that
//   refreshes when you look at it teaches you to look at it.
//
//   ONE LINE EACH, AND A CAP. No expansion, no thread, no full profile. If a
//   chapter is interesting, the line carries their URL and you go and read
//   their actual site, which is somebody else's commons and not this app's
//   content.
//
//   NO RECIPROCITY. Nothing here generates a task, appears in whats_next(), or
//   tells you that you have not published lately. It is not an inbox and there
//   is nothing to keep up with. That is the difference between belonging to a
//   network and owing one.
//
//   NOTHING FROM A NEIGHBOUR IS EVER A SIGNAL. Their text is displayed as
//   theirs, never written into this commons' own tables. A neighbour publishing
//   "creek contaminated" must not become an observation here — the observation
//   belongs to them, about their ground, and the provenance rules everywhere
//   else in this project exist precisely so that stream stays clean.
import { all, one, run } from '../core/db.mjs';
import { parseStamp } from '../core/time.mjs';
import { getJSON } from '../adapters/http.mjs';
import { classifyPeer } from '../adapters/murmurations.mjs';

export const CADENCE_DAYS = 7;

// A profile is a small JSON document. Anything much larger is not a
// Murmurations profile, and a neighbour is not a reason to read 40 MB.
const TIMEOUT_MS = 8000;
const LINE = 180;

/**
 * What the neighbours have published, as this commons last saw it.
 *
 * Read-only and offline: it reports what refresh() stored. A network call here
 * would make the panel a live feed, which is the thing being avoided.
 */
export function neighbours(chapterId, { limit = 8 } = {}) {
  if (!chapterId) return { error: 'no_chapter' };

  const peers = all(
    `SELECT id, name, url, kind, bioregion_name, status, notes, summary, summary_at, last_synced_at
       FROM federation_peers
      WHERE status IN ('known', 'connected', 'sharing')
      ORDER BY coalesce(summary_at, last_synced_at) DESC, name`);

  const items = peers
    .filter((p) => p.summary)
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      url: p.url,
      where: p.bioregion_name ?? null,
      // Said, rather than assumed. Only a peer whose own published tags claim
      // to be a bioregional commons is called a chapter; the rest are what the
      // index actually returned, which is organisations that happen to be near
      // this point. Both are worth knowing about and they are not the same
      // thing, and the difference is the publisher's claim, not our guess.
      kind: p.kind ?? 'unknown',
      is_chapter: p.kind === 'chapter',
      line: p.summary,
      seen_at: p.summary_at,
      // "Changed since last week" is the only thing here that is ever news, and
      // it is a quiet marker rather than a badge or a count.
      changed: p.notes === 'changed',
    }));

  const last = peers.map((p) => p.summary_at).filter(Boolean).sort().at(-1) ?? null;

  return {
    chapter: one('SELECT name FROM chapters WHERE id=?', chapterId)?.name ?? chapterId,
    known: peers.length,
    items,
    last_looked: last,
    stale: last ? daysSince(last) > CADENCE_DAYS * 2 : null,
    // Said plainly, because a list of other people's activity with no stated
    // limit is one a person will assume they are supposed to keep up with.
    obligation: 'None. Nothing here needs answering, and nobody is told whether you read it.',
    chapters: items.filter((i) => i.is_chapter).length,
    sentence: !peers.length
      ? 'Nobody else known yet. Federation is a discovery step, not a requirement — ' +
        'a commons works perfectly well with no neighbours at all.'
      : !items.length
        ? `${peers.length} neighbour${peers.length === 1 ? '' : 's'} known, none of them ` +
          'published anything this commons has read yet.'
        : neighbourSentence(items, peers, last),
  };
}

/**
 * The count of actual chapters is stated separately from the count of
 * neighbours, because they answer different questions — "is anyone else doing
 * this?" and "who else is around?" — and rolling them together answers the
 * first one flatteringly.
 */
function neighbourSentence(items, peers, last) {
  const chapters = items.filter((i) => i.is_chapter).length;
  const looked = last ? `Last looked ${daysSince(last)} days ago.` : '';
  return chapters
    ? `${chapters} other bioregional chapter${chapters === 1 ? '' : 's'} and ` +
      `${items.length - chapters} other organisation${items.length - chapters === 1 ? '' : 's'} ` +
      `nearby have published something. ${looked}`
    : `${items.length} organisation${items.length === 1 ? '' : 's'} near here have published ` +
      `something, and none of them is another bioregional chapter yet. ${looked}`;
}

/**
 * Fetch each known peer's published profile. Called by the heartbeat weekly.
 *
 * One dead neighbour must never cost the rest: every fetch is caught
 * individually, and a peer that cannot be read keeps the line it had rather
 * than being emptied. Their site being down is not news about them.
 */
export async function refresh({ force = false, limit = 40 } = {}) {
  const peers = all(
    `SELECT id, name, url, kind, summary, summary_at FROM federation_peers
      WHERE url IS NOT NULL AND status IN ('known', 'connected', 'sharing')
      ORDER BY coalesce(summary_at, '') ASC LIMIT ?`, limit);

  let read = 0, changed = 0, failed = 0, skipped = 0;
  for (const p of peers) {
    if (!force && p.summary_at && daysSince(p.summary_at) < CADENCE_DAYS) { skipped++; continue; }
    let profile = null;
    try {
      const r = await getJSON(p.url, { timeout: TIMEOUT_MS, ttlMs: CADENCE_DAYS * 86400000 });
      profile = r.data;
    } catch {
      failed++;
      continue;                      // keep whatever line they had
    }
    const line = summarise(profile);
    if (!line) { failed++; continue; }
    read++;
    const moved = p.summary && p.summary !== line;
    if (moved) changed++;

    // Re-classify from what they actually published, which is the only place a
    // peer's kind can honestly come from. This is also how the rows the
    // constraint migration reset to "unknown" heal themselves: discovery
    // recorded them before there was anywhere to keep the tags, and the next
    // read of the profile has the tags right there in it.
    const kind = classifyPeer({ tags: profile.tags, name: p.name });
    run(`UPDATE federation_peers
            SET summary=?, summary_at=datetime('now'), notes=?, last_synced_at=datetime('now'),
                tags=?, kind=?
          WHERE id=?`,
      line, moved ? 'changed' : null,
      Array.isArray(profile.tags) && profile.tags.length ? JSON.stringify(profile.tags) : null,
      kind, p.id);
  }
  return { peers: peers.length, read, changed, failed, skipped };
}

/**
 * One line, from somebody else's profile.
 *
 * Everything here is third-party text from a public index, so it is treated the
 * way every other untrusted string in this project is treated: taken as data,
 * never as instruction, flattened to plain text, and cut to a length that
 * cannot take over the panel. A neighbour cannot buy more of this screen by
 * writing more words.
 */
export function summarise(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const bits = [
    profile.description,
    Array.isArray(profile.tags) ? profile.tags.slice(0, 6).join(', ') : null,
    profile.mission,
  ].map(clean).filter(Boolean);
  if (!bits.length) return null;
  const line = bits[0];
  return line.length > LINE ? `${line.slice(0, LINE - 1)}…` : line;
}

/** Plain text, one line, no markup, no control characters. */
function clean(s) {
  if (typeof s !== 'string') return null;
  const t = s
    .replace(/<[^>]*>/g, ' ')                        // any markup they published
    // eslint-disable-next-line no-control-regex
    .replace(/[ --]/g, ' ')   // control characters
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

function daysSince(ts) {
  if (!ts) return 0;
  const d = parseStamp(ts);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
