// ── Engine: Council ───────────────────────────────────────────────────────
// Mandate: make legitimate, transparent, repairable decisions.
// The manual's rules are enforced here rather than left to good intentions.
import { all, one, create, run } from '../core/db.mjs';
import { context as landSeatContext } from './landseat.mjs';

/** Decisions that need a heavier method than the one chosen. */
const IRREVERSIBLE_METHODS = ['supermajority_consensus', 'explicit_permission'];

export function propose(chapterId, d) {
  // Every agenda item carries a Land Seat report. No report, no proposal.
  if (!d.land_seat_report) {
    return {
      error: 'missing_land_seat',
      message: 'Every council agenda item requires a Land Seat report: ecological ' +
               'observations, seasonal conditions, downstream effects, uncertainty, red flags.',
    };
  }
  // Rights before efficiency: an irreversible decision cannot ride a light method.
  // Absent an explicit flag a decision is reversible — the schema default.
  const reversible = d.reversible !== false && d.reversible !== 0;
  if (!reversible && !IRREVERSIBLE_METHODS.includes(d.method)) {
    return {
      error: 'method_too_light',
      message:
        `An irreversible decision cannot use "${d.method}". The manual requires ` +
        'supermajority/consensus with an affected-party process, written analysis, ' +
        'and a reconsideration period.',
    };
  }
  // Freeze what the land was doing at the moment this was proposed.
  //
  // Not a check on the report and not a substitute for it — the report is still
  // required and still written by a person. This is the record that makes
  // "monitoring must change decisions" answerable later: a decision taken in
  // the third year of a drought reads very differently once the drought breaks,
  // and without this nobody can tell which of the two they are reading.
  //
  // Captured rather than fetched, so a council meeting with no wifi still gets
  // it, and a failure here must never block a proposal — the Land Seat report
  // is the requirement; this is the corroboration.
  let land_seat_context = null;
  try { land_seat_context = JSON.stringify(landSeatContext(chapterId, { place_id: d.place_id })); }
  catch { land_seat_context = null; }

  return create('decisions', 'decision', chapterId,
                { ...d, reversible: reversible ? 1 : 0, chapter_id: chapterId,
                  status: 'proposed', land_seat_context });
}

export function decide(id, { decided_by, review_date } = {}) {
  const d = one('SELECT * FROM decisions WHERE id = ?', id);
  if (!d) return { error: 'not_found' };
  if (d.red_flags && d.red_flags.trim()) {
    return { error: 'red_flag_open', message: `Open red flag: ${d.red_flags}` };
  }
  if (!d.review_date && !review_date) {
    return { error: 'missing_review_date', message: 'Monitoring must change decisions — set a review date.' };
  }
  run(
    `UPDATE decisions SET status='decided', decided_at=datetime('now'), review_date=COALESCE(?,review_date) WHERE id=?`,
    review_date ?? null, id
  );
  return one('SELECT * FROM decisions WHERE id = ?', id);
}

/**
 * The Minimum Viable Chapter Test, from the manual — ten yes/no questions.
 * This is the closest thing the OS has to a health check, and it is deliberately
 * hard to pass by adding data alone.
 */
export function minimumViableTest(chapterId) {
  const c = one('SELECT * FROM chapters WHERE id = ?', chapterId);
  if (!c) return { error: 'no_chapter' };
  const n = (sql, ...p) => one(sql, ...p)?.n ?? 0;

  const checks = [
    {
      id: 'scope_published',
      q: 'Can anyone see what area and people the chapter does and does not represent?',
      pass: !!(c.represents?.trim() && c.does_not_represent?.trim()),
      fix: 'Fill in represents / does_not_represent on the chapter.',
    },
    {
      id: 'intake_loop',
      q: 'Can a person submit a need, receive a response, and appeal a decision?',
      pass: n(`SELECT COUNT(*) n FROM intake WHERE chapter_id=? AND status!='received'`, chapterId) > 0
            && n('SELECT COUNT(*) n FROM intake WHERE chapter_id=? AND response IS NOT NULL', chapterId) > 0,
      fix: 'Respond to at least one intake item and move it out of "received".',
    },
    {
      id: 'place_named',
      q: 'Can the council name its watershed, ecoregion, seasonal risks, and baseline indicators?',
      pass: n('SELECT COUNT(*) n FROM places WHERE chapter_id=? AND watershed_huc IS NOT NULL AND ecoregion_name IS NOT NULL', chapterId) > 0
            && n('SELECT COUNT(*) n FROM indicators WHERE chapter_id=? AND baseline_value IS NOT NULL', chapterId) > 0,
      fix: 'Resolve a place against the ecoregion/watershed adapters and record one baseline indicator.',
    },
    {
      id: 'decisions_documented',
      q: 'Are decision rights, conflicts of interest, budgets, and review dates documented?',
      pass: n(`SELECT COUNT(*) n FROM decisions WHERE chapter_id=? AND status='decided' AND review_date IS NOT NULL`, chapterId) > 0,
      fix: 'Record at least one decided decision carrying a review date.',
    },
    {
      id: 'protection_in_place',
      q: 'Are cultural knowledge, youth, personal data, rights-holders, and sensitive ecological information protected?',
      pass: n(`SELECT COUNT(*) n FROM rids WHERE chapter_id=? AND sensitivity IN ('restricted','sacred')`, chapterId) > 0
            || n('SELECT COUNT(*) n FROM media_consent WHERE chapter_id=?', chapterId) > 0,
      fix: 'Register at least one consent record or classify sensitive material above "public".',
    },
    {
      id: 'one_project_done',
      q: 'Has one useful project been completed and maintained?',
      pass: n(`SELECT COUNT(*) n FROM quests WHERE chapter_id=? AND status='Complete' AND maintenance_owner IS NOT NULL`, chapterId) > 0,
      fix: 'Complete one quest and name its maintenance owner.',
    },
    {
      id: 'work_relationships_clear',
      q: 'Can contributors distinguish paid, credit, work-trade, apprentice, and volunteer work?',
      pass: n('SELECT COUNT(DISTINCT relationship) n FROM exchange_events WHERE chapter_id=?', chapterId) > 1
            && n(`SELECT COUNT(*) n FROM exchange_events WHERE chapter_id=? AND terms_ack=0 AND relationship!='volunteer'`, chapterId) === 0,
      fix: 'Log exchange events with explicit relationships and acknowledged terms.',
    },
    {
      id: 'ai_advisory_only',
      q: 'Does AI remain advisory and logged?',
      pass: n('SELECT COUNT(*) n FROM ai_log WHERE chapter_id=? AND human_reviewer IS NOT NULL', chapterId)
            === n('SELECT COUNT(*) n FROM ai_log WHERE chapter_id=?', chapterId),
      fix: 'Every AI log entry needs a named human reviewer.',
    },
    {
      id: 'survives_founder',
      q: 'Can the group continue functioning if one founder steps away?',
      // Two DIFFERENT people, named in advance, and a second who has agreed.
      //
      // This used to pass on "more than one person has served the Land Seat",
      // which a chapter satisfies by having had a busy month. It is evidence
      // that two people once did something, not that anything is arranged —
      // and the arrangement has to exist BEFORE it is needed, because the
      // moment it is needed is the moment nobody can ask.
      //
      // Community networks have gone dark for months over a single person's
      // computer. That failure looks technical and is entirely governance.
      pass: (() => {
        const c = one(
          'SELECT steward, deputy, deputy_agreed_at FROM chapters WHERE id=?', chapterId) ?? {};
        const s = String(c.steward ?? '').trim();
        const d = String(c.deputy ?? '').trim();
        return !!(s && d && s.toLowerCase() !== d.toLowerCase() && c.deputy_agreed_at);
      })(),
      fix: 'Name a steward and a deputy who are different people, and record that the ' +
           'deputy has agreed: name_deputy. They need to know where the backup lives and ' +
           'have restored one themselves at least once.',
    },
    {
      id: 'reported_failure',
      q: 'Has the group publicly reported what failed, changed, or was stopped?',
      pass: n(`SELECT COUNT(*) n FROM quests WHERE chapter_id=? AND status='Stopped'`, chapterId) > 0
            || n(`SELECT COUNT(*) n FROM learn WHERE chapter_id=? AND kind='case_study'`, chapterId) > 0,
      fix: 'Publish a case study, or record a quest that was honestly stopped.',
    },
  ];
  const passed = checks.filter((c2) => c2.pass).length;
  return { chapter: c.name, passed, total: checks.length, viable: passed === checks.length, checks };
}

export function agenda(chapterId) {
  return all(
    `SELECT * FROM decisions WHERE chapter_id=? AND status IN ('proposed','in_review')
     ORDER BY created_at`, chapterId
  );
}

/** Decisions whose review date has arrived — the loop closing on itself. */
export function dueForReview(chapterId) {
  return all(
    `SELECT * FROM decisions WHERE chapter_id=? AND status='decided'
       AND review_date IS NOT NULL AND date(review_date) <= date('now')
     ORDER BY review_date`, chapterId
  );
}
