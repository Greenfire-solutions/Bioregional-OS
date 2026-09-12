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
