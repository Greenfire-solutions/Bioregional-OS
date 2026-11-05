// ── Engine: Exchange ──────────────────────────────────────────────────────
// Mandate: circulate money, credits, tools, care, and jobs locally.
// Protocol rule: contributors know the terms BEFORE work begins. Credits
// supplement fair wages; they do not disguise unpaid labour.
import { create, one, all } from '../core/db.mjs';
import { exportLedger, contributionSummary, unacknowledgedTerms } from '../adapters/valueflows.mjs';

const TERMS_REQUIRED = ['paid', 'contractor', 'apprentice', 'credit', 'work_trade', 'revenue_share'];

export function record(chapterId, ev) {
  if (TERMS_REQUIRED.includes(ev.relationship) && !ev.terms_ack) {
    return {
      error: 'terms_not_acknowledged',
      message:
        `A "${ev.relationship}" relationship requires the contributor to have seen ` +
        'compensation, ownership, verification, cancellation, revenue distribution, ' +
        'and community/ecological return before work begins.',
    };
  }
  return create('exchange_events', 'exchange_event', chapterId, { ...ev, chapter_id: chapterId });
}

export { exportLedger, contributionSummary, unacknowledgedTerms };

/** Does value actually return to the people and place that carried the work? */
export function benefitFlow(chapterId) {
  const byRelationship = all(
    `SELECT relationship, COUNT(*) events, SUM(COALESCE(vf_quantity,0)) total, vf_unit
       FROM exchange_events WHERE chapter_id=? GROUP BY relationship, vf_unit`, chapterId);
  const volunteerHours = byRelationship
    .filter((r) => r.relationship === 'volunteer' && /hour/i.test(r.vf_unit ?? ''))
    .reduce((s, r) => s + (r.total ?? 0), 0);
  const paidHours = byRelationship
    .filter((r) => ['paid', 'contractor', 'apprentice'].includes(r.relationship) && /hour/i.test(r.vf_unit ?? ''))
    .reduce((s, r) => s + (r.total ?? 0), 0);
  const total = volunteerHours + paidHours;
  return {
    by_relationship: byRelationship,
    volunteer_hours: volunteerHours,
    paid_hours: paidHours,
    // A chapter running almost entirely on unpaid labour is a finding, not a virtue.
    unpaid_share: total ? Number((volunteerHours / total).toFixed(2)) : null,
    warning: total && volunteerHours / total > 0.8
      ? 'Over 80% of recorded hours are unpaid. The manual treats exhaustion as a failure mode.'
      : null,
  };
}
