// ── ValueFlows / REA adapter ──────────────────────────────────────────────
// Upstream: valueflo.ws vocabulary; compatible implementations include
// hREA (Holochain) and bonfire_valueflows (AGPL/Elixir).
// The Exchange engine stores events in VF shape already, so this is a
// faithful projection rather than a lossy translation.
import { all, one } from '../core/db.mjs';

export const VF_CONTEXT = 'https://w3id.org/valueflows';

/** Export a chapter's contribution ledger as ValueFlows JSON-LD. */
export function exportLedger(chapterId) {
  const events = all(
    `SELECT e.*, p.name AS provider_name, r.name AS receiver_name, q.title AS quest_title
       FROM exchange_events e
       LEFT JOIN agents p ON p.id = e.provider_id
       LEFT JOIN agents r ON r.id = e.receiver_id
       LEFT JOIN quests q ON q.id = e.quest_id
      WHERE e.chapter_id = ?
      ORDER BY e.occurred_at DESC`,
    chapterId
  );
  const agents = all('SELECT * FROM agents WHERE chapter_id = ?', chapterId);
  return {
    '@context': VF_CONTEXT,
    '@type': 'EconomicNetwork',
    name: one('SELECT name FROM chapters WHERE id = ?', chapterId)?.name ?? chapterId,
    agents: agents.map((a) => ({
      '@type': a.vf_agent_type,
      id: a.id,
      name: a.name,
      note: a.role || undefined,
    })),
    economicEvents: events.map((e) => ({
      '@type': 'EconomicEvent',
      id: e.id,
      action: e.vf_action,
      provider: e.provider_id || undefined,
      receiver: e.receiver_id || undefined,
      resourceConformsTo: e.resource_name || undefined,
      effortQuantity: e.vf_quantity != null
        ? { hasNumericalValue: e.vf_quantity, hasUnit: e.vf_unit || 'one' }
        : undefined,
      hasPointInTime: e.occurred_at,
      inScopeOf: e.quest_id || undefined,
      note: e.note || undefined,
      // Not part of VF core — the manual requires the work relationship to be
      // explicit and acknowledged before work begins, so it rides along.
      'bros:relationship': e.relationship,
      'bros:termsAcknowledged': !!e.terms_ack,
    })),
  };
}

/** Contribution summary per agent — who actually carried the work. */
export function contributionSummary(chapterId) {
  return all(
    `SELECT a.name, a.role, e.relationship,
            COUNT(*) AS events,
            SUM(COALESCE(e.vf_quantity,0)) AS total_quantity,
            e.vf_unit
       FROM exchange_events e
       JOIN agents a ON a.id = e.provider_id
      WHERE e.chapter_id = ?
      GROUP BY a.id, e.relationship, e.vf_unit
      ORDER BY total_quantity DESC`,
    chapterId
  );
}

/** Unacknowledged terms are a governance failure, not a data gap. */
export function unacknowledgedTerms(chapterId) {
  return all(
    `SELECT e.id, e.relationship, e.resource_name, a.name AS provider_name, e.occurred_at
       FROM exchange_events e LEFT JOIN agents a ON a.id = e.provider_id
      WHERE e.chapter_id = ? AND e.terms_ack = 0
        AND e.relationship IN ('paid','contractor','apprentice','credit','work_trade','revenue_share')`,
    chapterId
  );
}
