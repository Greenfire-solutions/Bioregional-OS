// ── Engine: Data / AI + Media consent ─────────────────────────────────────
// Mandate: organize knowledge without extracting or replacing people.
import { all, one, create, run } from '../core/db.mjs';

/** Things AI may never decide. Named in the manual; enforced as a list. */
export const AI_FORBIDDEN = [
  'membership worth', 'punishment', 'project legitimacy', 'funding winners',
  'cultural permission', 'land rights', 'safety clearance',
  'truth of contested testimony', 'who deserves care',
];

export function logAI(chapterId, entry) {
  const purpose = (entry.purpose || '').toLowerCase();
  const hit = AI_FORBIDDEN.find((f) => purpose.includes(f.split(' ')[0]) && purpose.includes(f.split(' ').at(-1)));
  if (hit) {
    return {
      error: 'forbidden_purpose',
      message: `AI may assist but may not decide "${hit}". Record a human decision instead.`,
    };
  }
  if (!entry.human_reviewer) {
    return { error: 'reviewer_required', message: 'Every material AI use names a human reviewer.' };
  }
  if (['restricted', 'sacred'].includes(entry.data_class) && !entry.correction_path) {
    return {
      error: 'correction_path_required',
      message: 'Restricted or sacred material requires a documented correction and withdrawal path.',
    };
  }
  return create('ai_log', 'ai_log', chapterId, { ...entry, chapter_id: chapterId });
}

/**
 * An AI action, recorded as it happens rather than declared afterwards.
 *
 * The manual: "Whenever AI materially shapes a public report, map, plan, match,
 * or recommendation, the chapter should log the tool, purpose, data class,
 * human reviewer, known limits, and correction path."
 *
 * That was implemented as `logAI` — a tool the assistant had to choose to call
 * ON ITSELF. So the register existed, the operator counted unreviewed entries,
 * the Minimum Viable Chapter Test checked it, and an assistant could open
 * projects, close gates and propose decisions without ever writing a row. A
 * transparency log that depends on the logged party volunteering is not a log.
 *
 * Deliberately different from logAI in one respect: this writes with NO human
 * reviewer, and that is the point rather than an omission. The reviewer is a
 * person confirming afterwards that the AI's work was sound, and at the moment
 * of the action no such person exists. engines/operator.mjs already treats an
 * ai_log row without a reviewer as blocking work — which until now could only
 * ever be zero. This is what makes that check mean something.
 *
 * The forbidden-purpose guard does NOT apply here. logAI refuses to record a
 * decision AI may not make; this records what an AI actually did, and refusing
 * to write the record of a thing that already happened would destroy exactly
 * the evidence somebody needs. The gates are what stop the action; this is what
 * remembers it.
 */
export function recordAIAction(chapterId, { tool, purpose, data_class, affected_object_rid, via } = {}) {
  if (!chapterId || !tool) return null;
  try {
    return create('ai_log', 'ai_log', chapterId, {
      chapter_id: chapterId,
      tool: via ? `${tool} (${via})` : tool,
      purpose: purpose || `Ran ${tool}`,
      data_class: data_class || 'members',
      affected_object_rid: affected_object_rid ?? null,
      human_reviewer: null,
      known_limits: 'Recorded automatically at the moment of the action. Nobody has reviewed it yet.',
      correction_path: 'Any steward may reverse or amend the affected record, and should note why.',
    });
  } catch {
    // A failure to write the log must never fail the action it is logging —
    // that would make the safest configuration the one where nothing works.
    return null;
  }
}

/** Consent that has lapsed, been withdrawn, or was never reviewed. */
export function consentAudit(chapterId) {
  return {
    withdrawn: all('SELECT * FROM media_consent WHERE chapter_id=? AND withdrawn_at IS NOT NULL', chapterId),
    unreviewed: all(
      `SELECT * FROM media_consent WHERE chapter_id=? AND review_before_publication=1 AND granted_at IS NULL`,
      chapterId),
    no_benefit_sharing: all(
      `SELECT * FROM media_consent WHERE chapter_id=? AND (benefit_sharing IS NULL OR benefit_sharing='')`,
      chapterId),
  };
}

/** Anything classified above 'members' that is about to be exported publicly. */
export function protectedInventory(chapterId) {
  return all(
    `SELECT object_type, sensitivity, COUNT(*) n FROM rids
      WHERE chapter_id=? AND sensitivity IN ('restricted','sacred','council')
      GROUP BY object_type, sensitivity`, chapterId);
}
